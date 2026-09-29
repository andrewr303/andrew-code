"""Pure-Python panelist dispatch — no bash required on Windows."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

from codefusion.config import load_config
from codefusion.detect import detect_agents, mark_degraded


@dataclass
class Reply:
    provider: str
    text: str
    status: str  # returned | absent | timeout | error | host-skip
    ok: bool
    model: str = ""
    elapsed_s: float = 0.0
    error: str = ""

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def _which(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        for ext in (".exe", ".cmd", ".bat"):
            found = shutil.which(name + ext)
            if found:
                return found
    return None


def _run(
    argv: list[str],
    *,
    cwd: Optional[Path] = None,
    timeout: int = 600,
    env: Optional[dict[str, str]] = None,
) -> tuple[int, str, str]:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd) if cwd else None,
            env=merged,
            encoding="utf-8",
            errors="replace",
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired as exc:
        out = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        err = (exc.stderr or "") if isinstance(exc.stderr, str) else f"timeout after {timeout}s"
        return 124, out, err
    except FileNotFoundError as exc:
        return 127, "", str(exc)
    except OSError as exc:
        return 1, "", str(exc)


def _clean(text: str) -> str:
    # Strip common CLI chrome lines.
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            lines.append(line)
            continue
        if s.startswith("╭") or s.startswith("╰") or s.startswith("│"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _opencode_extract(raw: str) -> str:
    """Pull assistant text from opencode JSON event stream when present."""
    chunks: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        # Tolerate shape drift across opencode versions.
        if isinstance(obj, dict):
            if obj.get("type") in {"text", "message", "assistant"} and isinstance(obj.get("text"), str):
                chunks.append(obj["text"])
            part = obj.get("part") or obj.get("delta")
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
            msg = obj.get("message")
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    chunks.append(content)
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and isinstance(c.get("text"), str):
                            chunks.append(c["text"])
    if chunks:
        return "".join(chunks).strip()
    return _clean(raw)


def dispatch(
    provider: str,
    prompt: str,
    *,
    model: str = "",
    effort: str = "",
    timeout: Optional[int] = None,
    cwd: Optional[Path] = None,
    allow_host: bool = False,
) -> Reply:
    """Run one panelist. Never raises."""
    cfg = load_config()
    host = cfg.orchestrator_provider
    timeout = timeout or cfg.panel_timeout_s
    work = cwd or Path.cwd()
    t0 = time.time()

    if provider == host and not allow_host:
        return Reply(
            provider=provider,
            text="",
            status="host-skip",
            ok=False,
            model=model or cfg.orchestrator_model,
            error=f"'{provider}' is the host conductor — fold its view in-context, not as a subprocess.",
        )

    roster = {e["provider"]: e for e in cfg.roster}
    entry = roster.get(provider, {})
    model = model or str(entry.get("model") or "")
    effort = effort or str(entry.get("effort") or "")
    binary_name = str(entry.get("bin") or provider)
    binary = _which(binary_name)
    if not binary:
        return Reply(
            provider=provider,
            text="",
            status="absent",
            ok=False,
            model=model,
            error=f"{binary_name} not found on PATH",
        )

    try:
        if provider == "codex":
            # codex exec --json is the non-interactive path used by puppetmaster.
            argv = [
                binary,
                "exec",
                "--json",
                "--skip-git-repo-check",
                "--ephemeral",
            ]
            if model:
                argv.extend(["-m", model])
            # Prompt as final arg.
            argv.append(prompt)
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _clean(out)
            # Prefer last agent_message from JSONL if present.
            for line in reversed(out.splitlines()):
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") in {"item.completed", "agent_message", "message"}:
                    item = ev.get("item") or ev
                    if isinstance(item, dict):
                        for key in ("text", "content", "message"):
                            if isinstance(item.get(key), str) and item[key].strip():
                                text = item[key].strip()
                                break
                if ev.get("type") == "turn.completed" and isinstance(ev.get("result"), str):
                    text = ev["result"]

        elif provider in {"claude", "claude-code"}:
            argv = [binary, "-p", prompt, "--output-format", "text"]
            if model:
                argv.extend(["--model", model])
            # Non-interactive permissions when available.
            argv.extend(["--permission-mode", "acceptEdits"])
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _clean(out)

        elif provider == "grok":
            with tempfile.NamedTemporaryFile(
                "w", suffix=".txt", delete=False, encoding="utf-8"
            ) as tf:
                tf.write(prompt)
                prompt_file = tf.name
            try:
                argv = [
                    binary,
                    "--prompt-file",
                    prompt_file,
                    "--output-format",
                    "plain",
                    "--always-approve",
                    "--cwd",
                    str(work),
                ]
                if model:
                    argv.extend(["-m", model])
                if effort:
                    argv.extend(["--effort", effort])
                rc, out, err = _run(argv, cwd=work, timeout=timeout)
                text = _clean(out)
            finally:
                try:
                    os.unlink(prompt_file)
                except OSError:
                    pass

        elif provider == "opencode":
            argv = [binary, "run", "--format", "json", "--dir", str(work)]
            if model:
                argv.extend(["-m", model])
            if effort:
                argv.extend(["--variant", effort])
            argv.append(prompt)
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _opencode_extract(out)

        elif provider == "copilot":
            argv = [
                binary,
                "-p",
                prompt,
                "--allow-all-tools",
                "--no-color",
                "-s",
                "-C",
                str(work),
            ]
            if model:
                argv.extend(["--model", model])
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _clean(out)

        elif provider == "agy":
            argv = [
                binary,
                "--print",
                prompt,
                "--print-timeout",
                f"{timeout}s",
                "--new-project",
                "--add-dir",
                str(work),
                "--dangerously-skip-permissions",
            ]
            if model:
                argv.extend(["--model", model])
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _clean(out)

        elif provider == "hermes":
            argv = [binary, "chat", "-q", prompt]
            rc, out, err = _run(argv, cwd=work, timeout=timeout)
            text = _clean(out)

        else:
            return Reply(
                provider=provider,
                text="",
                status="error",
                ok=False,
                model=model,
                error=f"unknown provider '{provider}'",
                elapsed_s=time.time() - t0,
            )

    except Exception as exc:  # noqa: BLE001 — never raise from dispatch
        return Reply(
            provider=provider,
            text="",
            status="error",
            ok=False,
            model=model,
            error=str(exc),
            elapsed_s=time.time() - t0,
        )

    elapsed = time.time() - t0
    if rc == 124:
        mark_degraded(provider)
        return Reply(
            provider=provider,
            text=text,
            status="timeout",
            ok=False,
            model=model,
            error=err or f"timeout after {timeout}s",
            elapsed_s=elapsed,
        )
    if rc != 0 or not text.strip():
        if rc == 127:
            mark_degraded(provider)
        return Reply(
            provider=provider,
            text=text,
            status="error" if rc != 0 else "absent",
            ok=False,
            model=model,
            error=err or f"exit {rc}",
            elapsed_s=elapsed,
        )
    return Reply(
        provider=provider,
        text=text,
        status="returned",
        ok=True,
        model=model,
        elapsed_s=elapsed,
    )


def panel(
    prompt: str,
    *,
    providers: Optional[list[str]] = None,
    timeout: Optional[int] = None,
    cwd: Optional[Path] = None,
    max_workers: int = 8,
) -> dict[str, Any]:
    """Fan out a panel concurrently. Absent ≠ agreement."""
    cfg = load_config()
    if providers is None:
        providers = [
            a.provider
            for a in detect_agents()
            if a.status == "available"
        ]
    # Never silently include the host as a subprocess unless forced via list.
    host = cfg.orchestrator_provider
    providers = [p for p in providers if p != host]

    results: dict[str, Reply] = {}
    if not providers:
        return {
            "prompt": prompt,
            "panel": [],
            "replies": {},
            "status": {},
            "ok": False,
            "error": "no external panelists available",
        }

    with ThreadPoolExecutor(max_workers=min(max_workers, len(providers))) as pool:
        futs = {
            pool.submit(dispatch, p, prompt, timeout=timeout, cwd=cwd): p
            for p in providers
        }
        for fut in as_completed(futs):
            p = futs[fut]
            try:
                results[p] = fut.result()
            except Exception as exc:  # noqa: BLE001
                results[p] = Reply(
                    provider=p, text="", status="error", ok=False, error=str(exc)
                )

    status = {p: results[p].status for p in providers}
    returned = [p for p in providers if results[p].ok]
    return {
        "prompt": prompt,
        "panel": providers,
        "replies": {p: results[p].dict() for p in providers},
        "status": status,
        "returned": returned,
        "ok": bool(returned),
        "host": host,
        "orchestrator_model": cfg.orchestrator_model,
    }
