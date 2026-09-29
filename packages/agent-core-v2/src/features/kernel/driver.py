"""Persistent kernel driver: executes caller-supplied code cells in one long-lived process.

Protocol (JSON per line on stdio):
  host -> driver: {"id": <n>, "code": <source>}
  driver -> host: {"id": <n>, "status": "ok"|"error", "output": <captured stdout+stderr>}
  driver -> host (bridge): {"bridge": <call-id>, "tool": "read"|"glob"|"grep", "args": {...}}
  host -> driver (bridge answer): {"bridge": <call-id>, "result": <json value> | {"__error__": msg}}

Globals persist across cells in GLOBALS. The `agent` object exposes read/glob/grep,
which round-trip synchronously through the host.

Stream discipline: REAL_OUT/REAL_IN are captured at import, before any cell runs.
Bridge traffic and cell results always use REAL_OUT; cell output is captured by
temporarily swapping sys.stdout/sys.stderr during exec only.
"""

import io
import json
import sys
import traceback

REAL_OUT = sys.stdout
REAL_IN = sys.stdin

GLOBALS: dict = {}


class _AgentBridge:
    def __init__(self) -> None:
        self._seq = 0

    def _call(self, tool: str, args: dict):
        self._seq += 1
        call_id = self._seq
        REAL_OUT.write(json.dumps({"bridge": call_id, "tool": tool, "args": args}) + "\n")
        REAL_OUT.flush()
        while True:
            line = REAL_IN.readline()
            if not line:
                raise RuntimeError("kernel host closed the bridge channel")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict) and msg.get("bridge") == call_id:
                result = msg.get("result")
                if isinstance(result, dict) and "__error__" in result:
                    raise RuntimeError(str(result["__error__"]))
                return result

    def read(self, path: str) -> str:
        """Read a workspace file, returned as text."""
        return self._call("read", {"path": path})

    def glob(self, pattern: str):
        """List workspace files matching a glob pattern."""
        return self._call("glob", {"pattern": pattern})

    def grep(self, pattern: str, path: str = "."):
        """Search workspace files for a regex; returns path:line matches."""
        return self._call("grep", {"pattern": pattern, "path": path})


GLOBALS["agent"] = _AgentBridge()


def run_cell(cell_id, code: str) -> None:
    try:
        compiled = compile(code, "<cell>", "exec")
    except SyntaxError:
        REAL_OUT.write(json.dumps({"id": cell_id, "status": "error",
                                   "output": traceback.format_exc()}) + "\n")
        REAL_OUT.flush()
        return
    buffer = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buffer
    try:
        exec(compiled, GLOBALS)
        status, output = "ok", buffer.getvalue()
    except BaseException:
        status, output = "error", buffer.getvalue() + traceback.format_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    REAL_OUT.write(json.dumps({"id": cell_id, "status": status, "output": output}) + "\n")
    REAL_OUT.flush()


def main() -> None:
    for line in REAL_IN:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(msg, dict) or "code" not in msg:
            continue
        run_cell(msg.get("id"), str(msg.get("code", "")))


main()
