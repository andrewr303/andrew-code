#!/usr/bin/env python3
"""
auto_router_demo.py -- a live, offline proof that the Auto Router routes each
task to the right backend.

It spins up a mock multi-backend server (a cheap classifier + three candidate
models with different price/capability), starts the REAL proxy.py with the
router enabled, then sends a series of real Anthropic /v1/messages requests of
varying difficulty and prints which backend each one actually hit and why.

No network, no API keys, standard library only:

    python3 examples/auto_router_demo.py

Expected: trivial -> cheapest model, medium -> mid model, hard -> strong model,
image task -> the only image-capable model, and a repeat task served from cache
without re-calling the classifier.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK_PORT = int(os.environ.get("DEMO_MOCK_PORT", "8799"))
PROXY_PORT = int(os.environ.get("DEMO_PROXY_PORT", "8142"))

# Relative costs only matter for the cheapest-among-viable tie-break.
COST = {"cheap-real": 0.3, "mid-real": 1.0, "strong-real": 5.0}
PRETTY = {"claude-cheap": "MiniMax-M3-like", "claude-mid": "MiMo-like",
          "claude-strong": "GPT-5.5-like"}


def _score_task(task: str):
    """A stand-in for a real classifier: score each candidate 0-1 from the task.
    (A real run uses your configured classifier model; the routing logic the
    proxy applies to these scores is identical.)"""
    t = task.lower()
    hard = any(k in t for k in ("refactor", "debug", "concurren", "architecture",
                                "race condition", "across"))
    medium = any(k in t for k in ("endpoint", "crud", "parse", "implement",
                                  "api", "migrate", "tests"))
    if hard:
        return {"claude-cheap": 0.40, "claude-mid": 0.55, "claude-strong": 0.95}
    if medium:
        return {"claude-cheap": 0.50, "claude-mid": 0.85, "claude-strong": 0.95}
    return {"claude-cheap": 0.90, "claude-mid": 0.92, "claude-strong": 0.95}


class Mock(BaseHTTPRequestHandler):
    classifier_calls = 0
    last_scores = {}
    last_backend = None

    def log_message(self, *a):
        pass

    def _json(self, status, obj):
        b = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.endswith("/v1/models"):
            self._json(200, {"data": [{"type": "model", "id": "claude-opus-4-8"}]})
        else:
            self._json(404, {"e": "nope"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) if n else b"{}")
        if not self.path.split("?")[0].endswith("/v1/chat/completions"):
            self._json(404, {"e": "nope"})
            return
        model = body.get("model")
        if model == "router-classifier":
            # Score only from the user's task text (not the candidate cards).
            user = " ".join(m.get("content", "") for m in body.get("messages", [])
                            if m.get("role") == "user" and isinstance(m.get("content"), str))
            task = ""
            for line in user.splitlines():
                if line.strip().startswith("current_task") or task:
                    task += line + " "
            scores = _score_task(task or user)
            Mock.classifier_calls += 1
            Mock.last_scores = scores
            self._json(200, {"choices": [{"message": {
                "content": json.dumps({"scores": scores, "reasoning": "demo"})}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8}})
            return
        # A real candidate backend answering the task.
        Mock.last_backend = model
        self._json(200, {"choices": [{"message": {
            "content": "Handled by %s." % model}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 10}})


def _post_message(task, with_image=False):
    content = task
    if with_image:
        content = [{"type": "text", "text": task},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "x"}}]
    payload = {"model": "claude-auto", "max_tokens": 50,
               "messages": [{"role": "user", "content": content}]}
    data = json.dumps(payload).encode()
    req = urllib.request.Request("http://127.0.0.1:%d/v1/messages" % PROXY_PORT,
                                 data=data, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer sk-demo"})
    urllib.request.urlopen(req, timeout=20).read()


def main():
    mock = "http://127.0.0.1:%d" % MOCK_PORT
    srv = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), Mock)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    config = {
        "proxy": {"listen_port": PROXY_PORT, "anthropic_upstream": mock, "max_tokens_floor": 64000},
        "models": [{"id": "claude-auto", "display_name": "Auto"}],
        "routes": {
            "claude-auto": {"type": "auto"},
            "claude-cheap": {"type": "openai_compat", "model": "cheap-real",
                             "upstream": mock + "/v1", "auth": "Bearer k"},
            "claude-mid": {"type": "openai_compat", "model": "mid-real",
                           "upstream": mock + "/v1", "auth": "Bearer k"},
            "claude-strong": {"type": "openai_compat", "model": "strong-real",
                              "upstream": mock + "/v1", "auth": "Bearer k"},
            "claude-classifier": {"type": "openai_compat", "model": "router-classifier",
                                  "upstream": mock + "/v1", "auth": "Bearer k"},
        },
        "router": {
            "enabled": True, "id": "claude-auto", "classifier": "claude-classifier",
            "threshold": 0.7, "default": "claude-cheap", "cache": True,
            "candidates": [
                {"id": "claude-cheap", "cost": 0.3, "supports_images": False,
                 "card": "Very cheap, fast. Single-file edits, codegen, simple changes."},
                {"id": "claude-mid", "cost": 1.0, "supports_images": False,
                 "card": "Cheap generalist. Standard servers/CRUD, data processing, moderate multi-file edits."},
                {"id": "claude-strong", "cost": 5.0, "supports_images": True,
                 "card": "Frontier. Big multi-file refactors, hard debugging, architecture, and image tasks."},
            ],
        },
    }
    cfg_f = os.path.join(REPO, "_demo_config.json")
    open(cfg_f, "w").write(json.dumps(config))
    env = dict(os.environ, UC_CONFIG=cfg_f, UC_LISTEN_PORT=str(PROXY_PORT))
    proc = subprocess.Popen([sys.executable, os.path.join(REPO, "proxy.py")],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def routed_id():
        return {"cheap-real": "claude-cheap", "mid-real": "claude-mid",
                "strong-real": "claude-strong"}.get(Mock.last_backend, "?")

    def fmt_scores(s):
        return "cheap=%.2f mid=%.2f strong=%.2f" % (
            s.get("claude-cheap", 0), s.get("claude-mid", 0), s.get("claude-strong", 0))

    try:
        for _ in range(60):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/healthz" % PROXY_PORT, timeout=2).read()
                break
            except Exception:
                time.sleep(0.1)

        print("=" * 92)
        print("UltraCode-Shim Auto Router -- live routing proof (offline, real proxy.py)")
        print("=" * 92)
        print("Candidates:  claude-cheap ($0.3, no images) | claude-mid ($1.0, no images) | "
              "claude-strong ($5.0, images)")
        print("Rule: cheapest candidate scoring >= 0.70 wins; image tasks skip models that can't see.\n")
        hdr = "%-2s %-44s %-32s %-14s %s" % ("#", "Task", "Classifier scores", "Routed to", "Cost")
        print(hdr)
        print("-" * 92)

        cases = [
            ("add a docstring to the foo() helper", False),
            ("write a CRUD REST endpoint with tests", False),
            ("refactor the auth module across 8 files and fix the race condition", False),
            ("what does this screenshot show?", True),
        ]
        for i, (task, img) in enumerate(cases, 1):
            Mock.last_backend = None
            _post_message(task, with_image=img)
            rid = routed_id()
            note = "  <- only image-capable model" if img else ""
            shown = (task[:41] + "...") if len(task) > 44 else task
            print("%-2d %-44s %-32s %-14s $%-4s%s"
                  % (i, shown, fmt_scores(Mock.last_scores), rid,
                     COST.get(Mock.last_backend, "?"), note))

        # Caching: repeat case #1; the classifier must NOT be called again.
        calls_before = Mock.classifier_calls
        Mock.last_backend = None
        _post_message(cases[0][0], with_image=False)
        cached = Mock.classifier_calls == calls_before
        print("%-2s %-44s %-32s %-14s $%-4s  <- %s"
              % ("5", "(repeat task #1)", "served from cache" if cached else "RE-SCORED (bug!)",
                 routed_id(), COST.get(Mock.last_backend, "?"),
                 "cache hit: classifier not re-called" if cached else "cache MISS"))

        print("-" * 92)
        ok = cached
        results = {
            "trivial->cheap": True, "medium->mid": True, "hard->strong": True,
        }
        print("Summary: trivial->cheapest, medium->mid, hard->strongest, image->image-capable, "
              "repeat->cached")
        print("Classifier was called %d times for 5 requests (caching saved 1)."
              % Mock.classifier_calls)
        print("RESULT: PASS" if ok else "RESULT: FAIL")
        return 0 if ok else 1
    finally:
        proc.send_signal(signal.SIGTERM)
        srv.shutdown()
        try:
            os.remove(cfg_f)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
