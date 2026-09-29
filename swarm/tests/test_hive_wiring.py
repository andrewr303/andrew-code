"""Slice G — provider/CLI hive wiring.

Offline only: no live paid CLI calls. AndrewCode is a fake binary on PATH.
Stdlib unittest. Windows + Git Bash compatible.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
PROVIDERS = SCRIPTS / "providers"
FUSION_SH = SCRIPTS / "fusion.sh"
DETECT_SH = PROVIDERS / "detect.sh"
ANDREWCODE_SH = PROVIDERS / "andrewcode.sh"
COMMON_SH = PROVIDERS / "_common.sh"
DEFAULTS = ROOT / "config" / "defaults.env"


def _bash() -> str:
    found = shutil.which("bash")
    if found:
        return found
    candidate = Path(r"C:\Program Files\Git\bin\bash.exe")
    if candidate.is_file():
        return str(candidate)
    raise unittest.SkipTest("bash not on PATH (need Git Bash)")


def _posix(p: Path) -> str:
    s = str(p.resolve()).replace("\\", "/")
    if len(s) >= 2 and s[1] == ":":
        return f"/{s[0].lower()}{s[2:]}"
    return s


def _run_bash(script: str, env=None, timeout=30):
    e = os.environ.copy()
    if env:
        e.update(env)
    e.setdefault("PYTHONIOENCODING", "utf-8")
    return subprocess.run(
        [_bash(), "-c", script],
        cwd=str(ROOT),
        env=e,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


class HiveWiringStatic(unittest.TestCase):
    def test_fusion_version_is_3_0_0(self):
        src = FUSION_SH.read_text(encoding="utf-8")
        self.assertIn('FUSION_VERSION="3.0.0"', src)
        proc = _run_bash(f"bash {_posix(FUSION_SH)} version")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("fusion 3.0.0", proc.stdout)

    def test_fusion_board_and_hive_verbs_exec_sibling_scripts(self):
        src = FUSION_SH.read_text(encoding="utf-8")
        self.assertIn('BOARD="$DIR/board.sh"', src)
        self.assertIn('HIVE="$DIR/hive.sh"', src)
        self.assertIn('board)     shift; exec bash "$BOARD" "$@"', src)
        self.assertIn('hive)      shift; exec bash "$HIVE" "$@"', src)
        self.assertIn("fusion.sh board", src)
        self.assertIn("fusion.sh hive", src)

    def test_live_providers_grep_includes_andrewcode(self):
        src = FUSION_SH.read_text(encoding="utf-8")
        self.assertIn('"(codex|copilot|opencode|grok|kimi|andrewcode)"', src)

    def test_providers_listing_includes_andrewcode(self):
        src = FUSION_SH.read_text(encoding="utf-8")
        self.assertIn('"andrewcode"', src)
        proc = _run_bash(f"bash {_posix(FUSION_SH)} providers")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("andrewcode", proc.stdout)

    def test_help_mentions_board_and_hive(self):
        proc = _run_bash(f"bash {_posix(FUSION_SH)} help")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("board", proc.stdout)
        self.assertIn("hive", proc.stdout)

    def test_detect_json_has_top_level_andrewcode(self):
        proc = _run_bash(f"bash {_posix(DETECT_SH)} --json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertIn("providers", payload)
        self.assertIn("andrewcode", payload["providers"])
        self.assertIn(
            payload["providers"]["andrewcode"],
            {"available", "missing", "degraded", "host-native"},
        )
        # metaloop may also list it; top-level providers is the contract
        self.assertIsInstance(payload["providers"]["andrewcode"], str)

    def test_detect_text_lists_andrewcode(self):
        proc = _run_bash(f"bash {_posix(DETECT_SH)}")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertRegex(proc.stdout, r"(?m)^andrewcode:(available|missing|degraded|host-native)$")

    def test_common_applies_andrewcode_userconfig(self):
        src = COMMON_SH.read_text(encoding="utf-8")
        self.assertIn("fusion_apply_userconfig FUSION_ANDREWCODE_MODEL", src)
        self.assertIn("andrewcode_model", src)
        self.assertIn("fusion_apply_userconfig FUSION_ANDREWCODE_EFFORT", src)
        self.assertIn("andrewcode_effort", src)

    def test_defaults_hive_keys(self):
        src = DEFAULTS.read_text(encoding="utf-8")
        self.assertIn("FUSION_HIVE_MAX_DEPTH", src)
        self.assertIn("${FUSION_HIVE_MAX_DEPTH:-2}", src)
        self.assertIn("FUSION_HIVE_MAX_CHILDREN", src)
        self.assertIn("${FUSION_HIVE_MAX_CHILDREN:-4}", src)
        self.assertIn("FUSION_HIVE_MAX_AGENTS", src)
        self.assertIn("${FUSION_HIVE_MAX_AGENTS:-24}", src)
        self.assertIn("FUSION_ANDREWCODE_AUTO", src)
        self.assertIn("${FUSION_ANDREWCODE_AUTO:-1}", src)
        self.assertIn("FUSION_ARCHITECT_PROVIDER", src)
        self.assertIn("${FUSION_ARCHITECT_PROVIDER:-fable}", src)
        self.assertIn("FUSION_ARCHITECT_MODEL", src)
        self.assertIn("${FUSION_ARCHITECT_MODEL:-fable-5.1}", src)
        self.assertIn("FUSION_ASTRA_MODEL", src)
        self.assertIn("${FUSION_ASTRA_MODEL:-gpt-6-astra}", src)
        self.assertRegex(src, r"(?i)nested workers are always real AndrewCode")

    def test_andrewcode_adapter_keeps_scratch_and_snapshot(self):
        src = ANDREWCODE_SH.read_text(encoding="utf-8")
        self.assertIn("fusion_mk_scratch", src)
        self.assertIn("fusion_snapshot_repo", src)
        self.assertIn("fusion_worker_repo", src)
        self.assertIn("fusion_rm_scratch", src)
        self.assertIn("FUSION_ANDREWCODE_AUTO", src)
        self.assertIn("--auto -y", src)
        self.assertIn("FUSION_BOARD", src)
        self.assertIn("FUSION_AGENT_ID", src)
        # must not strip hive identity
        self.assertNotRegex(src, r"unset\s+FUSION_BOARD")
        self.assertNotRegex(src, r"unset\s+FUSION_AGENT_ID")
        self.assertNotRegex(src, r"env\s+-u\s+FUSION_BOARD")

    def test_bash_syntax(self):
        for path in (FUSION_SH, DETECT_SH, ANDREWCODE_SH, COMMON_SH):
            proc = _run_bash(f"bash -n {_posix(path)}")
            self.assertEqual(proc.returncode, 0, f"{path.name}: {proc.stderr}")


class HiveWiringRuntime(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fusion-hive-")
        self.td = Path(self.tmp.name)
        self.bindir = self.td / "bin"
        self.bindir.mkdir()
        self.argv_path = self.td / "argv.txt"
        self.env_path = self.td / "env.txt"
        fake = self.bindir / "andrewcode"
        fake.write_text(
            "#!/usr/bin/env bash\n"
            'echo "$*" > "${FUSION_TEST_ARGV:?}"\n'
            'printenv > "${FUSION_TEST_ENV:?}"\n'
            'echo "fake-ok"\n',
            encoding="utf-8",
            newline="\n",
        )
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.prompt = self.td / "prompt.txt"
        self.prompt.write_text("Reply PONG\n", encoding="utf-8")
        self.out = self.td / "out.txt"

    def tearDown(self):
        self.tmp.cleanup()

    def _dispatch(self, extra_exports: str = "") -> subprocess.CompletedProcess:
        path_prefix = _posix(self.bindir)
        script = f"""
set -uo pipefail
export PATH="{path_prefix}:$PATH"
export FUSION_TEST_ARGV="{_posix(self.argv_path)}"
export FUSION_TEST_ENV="{_posix(self.env_path)}"
export FUSION_ANDREWCODE_TIMEOUT=20
{extra_exports}
bash {_posix(ANDREWCODE_SH)} {_posix(self.prompt)} {_posix(self.out)}
"""
        return _run_bash(script, timeout=40)

    def test_auto_flags_on_by_default(self):
        # defaults.env fills AUTO=1 when unset; prove the hive default reaches argv.
        proc = self._dispatch("unset FUSION_ANDREWCODE_AUTO")
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        argv = self.argv_path.read_text(encoding="utf-8")
        self.assertIn("--auto", argv)
        self.assertRegex(argv, r"(^|\s)-y(\s|$)")
        self.assertIn("--output-format", argv)
        self.assertTrue(self.out.exists())
        self.assertIn("fake-ok", self.out.read_text(encoding="utf-8"))
        # scratch/snapshot bookkeeping copies
        self.assertTrue(Path(str(self.out) + ".log").exists() or Path(str(self.out) + ".raw").exists())

    def test_auto_flags_off_when_disabled(self):
        proc = self._dispatch('export FUSION_ANDREWCODE_AUTO=0')
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        argv = self.argv_path.read_text(encoding="utf-8")
        self.assertNotIn("--auto", argv)
        tokens = argv.split()
        self.assertNotIn("-y", tokens)

    def test_forwards_hive_identity_env(self):
        proc = self._dispatch(
            'export FUSION_BOARD="/tmp/hive.sqlite"\n'
            'export FUSION_AGENT_ID="worker-7"\n'
            'export FUSION_PARENT_ID="captain-1"\n'
            'export FUSION_SWARM_ID="swarm-9"\n'
        )
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        env_text = self.env_path.read_text(encoding="utf-8")
        self.assertIn("FUSION_BOARD=/tmp/hive.sqlite", env_text.replace("\r", ""))
        self.assertIn("FUSION_AGENT_ID=worker-7", env_text.replace("\r", ""))
        self.assertIn("FUSION_PARENT_ID=captain-1", env_text.replace("\r", ""))
        self.assertIn("FUSION_SWARM_ID=swarm-9", env_text.replace("\r", ""))

    def test_model_passthrough(self):
        path_prefix = _posix(self.bindir)
        script = f"""
set -uo pipefail
export PATH="{path_prefix}:$PATH"
export FUSION_TEST_ARGV="{_posix(self.argv_path)}"
export FUSION_TEST_ENV="{_posix(self.env_path)}"
export FUSION_ANDREWCODE_TIMEOUT=20
bash {_posix(ANDREWCODE_SH)} {_posix(self.prompt)} {_posix(self.out)} meta/custom-model xhigh
"""
        proc = _run_bash(script, timeout=40)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
        argv = self.argv_path.read_text(encoding="utf-8")
        self.assertIn("meta/custom-model", argv)

    def test_apply_userconfig_when_fusion_var_unset(self):
        empty = self.td / "empty.env"
        empty.write_text("# no keys\n", encoding="utf-8")
        script = f"""
unset FUSION_ANDREWCODE_MODEL FUSION_ANDREWCODE_EFFORT
export FUSION_CONFIG="{_posix(empty)}"
export CLAUDE_PLUGIN_OPTION_andrewcode_model="plugin-muse"
export CLAUDE_PLUGIN_OPTION_andrewcode_effort="low"
. {_posix(COMMON_SH)}
printf '%s\\n%s\\n' "$FUSION_ANDREWCODE_MODEL" "$FUSION_ANDREWCODE_EFFORT"
"""
        proc = _run_bash(script)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertGreaterEqual(len(lines), 2, proc.stdout)
        self.assertEqual(lines[-2], "plugin-muse")
        self.assertEqual(lines[-1], "low")

    def test_apply_userconfig_does_not_override_explicit(self):
        empty = self.td / "empty.env"
        empty.write_text("# no keys\n", encoding="utf-8")
        script = f"""
export FUSION_ANDREWCODE_MODEL="explicit-model"
export FUSION_ANDREWCODE_EFFORT="xhigh"
export FUSION_CONFIG="{_posix(empty)}"
export CLAUDE_PLUGIN_OPTION_andrewcode_model="plugin-muse"
export CLAUDE_PLUGIN_OPTION_andrewcode_effort="low"
. {_posix(COMMON_SH)}
printf '%s\\n%s\\n' "$FUSION_ANDREWCODE_MODEL" "$FUSION_ANDREWCODE_EFFORT"
"""
        proc = _run_bash(script)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertEqual(lines[-2], "explicit-model")
        self.assertEqual(lines[-1], "xhigh")

    def test_board_hive_verbs_exec_when_stubs_present(self):
        """Isolated copy of fusion.sh so we don't touch sibling-slice scripts."""
        work = self.td / "scripts"
        work.mkdir()
        fusion_src = FUSION_SH.read_text(encoding="utf-8")
        (work / "fusion.sh").write_text(fusion_src, encoding="utf-8", newline="\n")
        (work / "board.sh").write_text(
            '#!/usr/bin/env bash\nprintf "BOARD %s\\n" "$*"\n',
            encoding="utf-8",
            newline="\n",
        )
        (work / "hive.sh").write_text(
            '#!/usr/bin/env bash\nprintf "HIVE %s\\n" "$*"\n',
            encoding="utf-8",
            newline="\n",
        )
        fusion = _posix(work / "fusion.sh")
        proc = _run_bash(f"bash {fusion} board --db /tmp/x poll --agent a1")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("BOARD --db /tmp/x poll --agent a1", proc.stdout.replace("\r", ""))
        proc = _run_bash(f"bash {fusion} hive --dry-run --task ping")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("HIVE --dry-run --task ping", proc.stdout.replace("\r", ""))


if __name__ == "__main__":
    unittest.main()
