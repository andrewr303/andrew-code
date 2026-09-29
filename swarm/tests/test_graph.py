"""Offline unit tests for Fusion graph engineering (/fusion:graph).

No CLIs, no network: every dispatch is stubbed, so these assert the *topology*
behaviour — the part that is actually load-bearing and that a live smoke test
cannot pin down (dataflow vs waves, failure isolation, the stop rule).

Run:  python -m unittest tests.test_graph      (from the plugin root)
  or: python tests/test_graph.py
"""
import os
import sys
import tempfile
import threading
import time
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm import graph as G  # noqa: E402
from fusion_swarm import kgraph as K  # noqa: E402
from fusion_swarm.adapter import Reply  # noqa: E402


# --- dispatch stubs ---------------------------------------------------------

class Stub:
    """Records every dispatch and returns scripted replies."""

    def __init__(self, replies=None, delay=None, default="ok"):
        self.replies = replies or {}          # provider -> text | callable(prompt)
        self.delay = delay or {}              # provider -> seconds
        self.default = default
        self.calls = []
        self.started, self.finished = {}, {}
        self._lock = threading.Lock()

    def __call__(self, provider, prompt, model="", effort="", timeout=None, **kw):
        with self._lock:
            self.calls.append({"provider": provider, "prompt": prompt,
                               "model": model, "effort": effort})
            self.started[provider] = self.started.get(provider, time.perf_counter())
        if provider in self.delay:
            time.sleep(self.delay[provider])
        with self._lock:
            self.finished[provider] = time.perf_counter()
        r = self.replies.get(provider, self.default)
        text = r(prompt) if callable(r) else r
        if text is None:
            return Reply(provider, "", "absent", False)
        return Reply(provider, text, "returned", True)


def patched(stub):
    """Swap graph.dispatch for the duration of a with-block."""
    class _Ctx:
        def __enter__(self):
            self.orig = G.dispatch
            G.dispatch = stub
            return stub

        def __exit__(self, *a):
            G.dispatch = self.orig
    return _Ctx()


def spec(nodes, **kw):
    return {"name": "t", "nodes": nodes, **kw}


# --- lint -------------------------------------------------------------------

class TestLint(unittest.TestCase):
    def codes(self, nodes, budget=None, repeat=None):
        s = G.load_spec(spec(nodes))
        return {i["code"] for i in G.lint(s["nodes"], budget or s["budget"],
                                          repeat or s["repeat"])}

    def test_fake_edge_is_flagged(self):
        # b depends on a but never references it: the wait buys nothing.
        codes = self.codes([
            {"id": "a", "provider": "codex", "prompt": "do {{task}}"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "unrelated {{task}}"},
        ])
        self.assertIn("fake_edge", codes)

    def test_real_edge_is_not_flagged(self):
        codes = self.codes([
            {"id": "a", "provider": "codex", "prompt": "do {{task}}"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "read {{a}}"},
        ])
        self.assertNotIn("fake_edge", codes)
        codes = self.codes([
            {"id": "a", "provider": "codex", "prompt": "do {{task}}"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "read {{inputs}}"},
        ])
        self.assertNotIn("fake_edge", codes)

    def test_cycle_is_reported_not_hung(self):
        codes = self.codes([
            {"id": "a", "provider": "codex", "deps": ["b"]},
            {"id": "b", "provider": "grok", "deps": ["a"]},
        ])
        self.assertIn("cycle", codes)

    def test_two_writers_on_one_file(self):
        codes = self.codes([
            {"id": "a", "provider": "codex", "writes": ["src/x.ts"]},
            {"id": "b", "provider": "grok", "writes": ["src/x.ts"]},
        ])
        self.assertIn("two_writers", codes)

    def test_dangling_dep_and_missing_provider(self):
        codes = self.codes([{"id": "a", "deps": ["ghost"]}])
        self.assertIn("dangling_dep", codes)
        self.assertIn("no_provider", codes)

    def test_verify_threshold_cannot_exceed_voters(self):
        codes = self.codes([
            {"id": "a", "provider": "codex"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["a"],
             "voters": 2, "threshold": 3},
        ])
        self.assertIn("bad_threshold", codes)

    def test_router_with_one_target_is_not_a_decision(self):
        codes = self.codes([
            {"id": "r", "kind": "route", "provider": "codex", "targets": ["x"]},
            {"id": "x", "provider": "grok", "deps": ["r"]},
        ])
        self.assertIn("route_one_target", codes)

    def test_barrier_over_many_inputs_warns(self):
        nodes = [{"id": f"w{i}", "provider": "codex"} for i in range(4)]
        nodes.append({"id": "m", "kind": "reduce", "op": "concat",
                      "deps": [f"w{i}" for i in range(4)], "require": "all"})
        self.assertIn("barrier", self.codes(nodes))

    def test_redundant_edge_flagged(self):
        # c never reads a, and a is already upstream of b: the edge is pure clutter.
        codes = self.codes([
            {"id": "a", "provider": "codex"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "{{a}}"},
            {"id": "c", "provider": "grok", "deps": ["a", "b"], "prompt": "{{b}}"},
        ])
        self.assertIn("redundant_edge", codes)

    def test_wholesale_consumers_are_not_redundant(self):
        # {{inputs}} means every dep's text really is in the prompt — the edge
        # carries data even when the dependency is transitively implied.
        codes = self.codes([
            {"id": "a", "provider": "codex"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "{{inputs}}"},
            {"id": "c", "provider": "grok", "deps": ["a", "b"], "prompt": "{{inputs}}"},
        ])
        self.assertNotIn("redundant_edge", codes)
        self.assertNotIn("fake_edge", codes)

    def test_router_control_edges_are_not_fake(self):
        # A route target does not read the router's classification; it only
        # needs to be told it was chosen. That edge is control, not data.
        codes = self.codes([
            {"id": "r", "kind": "route", "provider": "codex", "targets": ["x", "y"],
             "prompt": "classify {{task}}"},
            {"id": "x", "provider": "grok", "deps": ["r"], "prompt": "handle {{task}}"},
            {"id": "y", "provider": "grok", "deps": ["r"], "prompt": "handle {{task}}"},
        ])
        self.assertNotIn("fake_edge", codes)

    def test_reduce_deps_are_never_fake(self):
        codes = self.codes([
            {"id": "a", "provider": "codex", "prompt": "x"},
            {"id": "b", "provider": "grok", "deps": ["a"], "prompt": "{{a}}"},
            {"id": "m", "kind": "reduce", "op": "concat", "deps": ["a", "b"]},
        ])
        self.assertNotIn("fake_edge", codes)
        self.assertNotIn("redundant_edge", codes)

    def test_loop_without_dry_condition_warns(self):
        s = G.load_spec(spec([{"id": "a", "provider": "codex"}],
                             repeat={"max_rounds": 3, "stop_after_dry_rounds": 0}))
        codes = {i["code"] for i in G.lint(s["nodes"], s["budget"], s["repeat"])}
        self.assertIn("loop_no_exit", codes)

    def test_node_cap_is_hard(self):
        nodes = [{"id": "f", "provider": "codex", "for_each": [str(i) for i in range(10)]}]
        s = G.load_spec(spec(nodes, budget={"max_nodes": 5}))
        codes = {i["code"] for i in G.lint(s["nodes"], s["budget"], s["repeat"])}
        self.assertIn("node_cap", codes)


# --- plan -------------------------------------------------------------------

class TestPlan(unittest.TestCase):
    def test_fanout_is_one_stage_wide_not_n_stages_deep(self):
        s = G.load_spec(spec([
            {"id": "w", "provider": "codex", "for_each": ["a", "b", "c", "d"]},
            {"id": "m", "kind": "reduce", "op": "concat",
             "deps": ["w#0", "w#1", "w#2", "w#3"]},
        ]))
        p = G.plan(s["nodes"], s["budget"], s["repeat"])
        self.assertEqual(p["nodes"], 5)
        self.assertEqual(p["max_parallel"], 4)
        self.assertEqual(p["critical_path"], 2)

    def test_deterministic_nodes_cost_nothing(self):
        s = G.load_spec(spec([
            {"id": "a", "provider": "codex"},
            {"id": "r", "kind": "reduce", "op": "dedupe", "deps": ["a"]},
            {"id": "g", "kind": "gate", "cmd": "true", "deps": ["r"]},
            {"id": "h", "kind": "human", "deps": ["g"], "reason": "deploys"},
        ]))
        p = G.plan(s["nodes"], s["budget"], s["repeat"])
        self.assertEqual(p["est_calls_per_round"], 1)
        self.assertEqual(set(p["free_nodes"]), {"r", "g", "h"})

    def test_verify_costs_one_call_per_voter(self):
        s = G.load_spec(spec([
            {"id": "a", "provider": "codex"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["a"], "voters": 3},
        ]))
        self.assertEqual(G.plan(s["nodes"])["est_calls_per_round"], 4)


# --- execution --------------------------------------------------------------

class TestExecution(unittest.TestCase):
    def test_dataflow_not_waves(self):
        """The headline claim: a node fires when ITS deps resolve, not when the
        whole stage does. `fast` and `slow` are both sources; `after_fast`
        depends only on `fast` and must start before `slow` finishes."""
        stub = Stub(delay={"opencode": 0.40})
        s = spec([
            {"id": "slow", "provider": "opencode", "prompt": "x"},
            {"id": "fast", "provider": "grok", "prompt": "x"},
            {"id": "after_fast", "provider": "copilot", "deps": ["fast"], "prompt": "{{fast}}"},
            {"id": "sink", "kind": "reduce", "op": "concat", "deps": ["slow", "after_fast"]},
        ])
        with patched(stub):
            res = G.run("t", spec=s, max_workers=4)
        self.assertTrue(res["ran"])
        self.assertLess(stub.started["copilot"], stub.finished["opencode"],
                        "downstream of the fast branch waited for an unrelated slow node "
                        "— that is wave scheduling, not dataflow")

    def test_failed_node_is_absent_and_does_not_sink_the_batch(self):
        stub = Stub(replies={"opencode": None, "grok": "found X"})
        s = spec([
            {"id": "a", "provider": "opencode", "prompt": "x"},
            {"id": "b", "provider": "grok", "prompt": "x"},
            {"id": "m", "kind": "reduce", "op": "concat", "deps": ["a", "b"]},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["status"]["a"], "absent")
        self.assertIn("a", res["absent"])
        self.assertIn("found X", res["final"]["m"])

    def test_absent_input_is_stated_never_silently_dropped(self):
        seen = {}

        def capture(prompt):
            seen["p"] = prompt
            return "done"

        stub = Stub(replies={"opencode": None, "copilot": capture})
        s = spec([
            {"id": "a", "provider": "opencode", "prompt": "x"},
            {"id": "b", "provider": "grok", "prompt": "x"},
            {"id": "c", "provider": "copilot", "deps": ["a", "b"], "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            G.run("t", spec=s)
        self.assertIn("ABSENT", seen["p"])
        self.assertIn("Do not treat this as agreement", seen["p"])

    def test_require_all_is_a_real_barrier(self):
        stub = Stub(replies={"opencode": None})
        s = spec([
            {"id": "a", "provider": "opencode", "prompt": "x"},
            {"id": "b", "provider": "grok", "prompt": "x"},
            {"id": "c", "provider": "copilot", "deps": ["a", "b"],
             "require": "all", "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["status"]["c"], "skipped")

    def test_router_fires_exactly_one_edge(self):
        stub = Stub(replies={"codex": "ROUTE: deep\nthis change is large"})
        s = spec([
            {"id": "r", "kind": "route", "provider": "codex",
             "targets": ["quick", "deep"], "prompt": "classify {{task}}"},
            {"id": "quick", "provider": "grok", "deps": ["r"], "prompt": "{{inputs}}"},
            {"id": "deep", "provider": "opencode", "deps": ["r"], "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["status"]["quick"], "skipped")
        self.assertEqual(res["status"]["deep"], "returned")
        self.assertNotIn("grok", [c["provider"] for c in stub.calls])

    def test_router_choice_is_code_not_prose(self):
        stub = Stub(replies={"codex": "I think we should probably do something"})
        s = spec([
            {"id": "r", "kind": "route", "provider": "codex",
             "targets": ["x", "y"], "prompt": "classify"},
            {"id": "x", "provider": "grok", "deps": ["r"], "prompt": "{{inputs}}"},
            {"id": "y", "provider": "grok", "deps": ["r"], "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        # no parseable route -> nothing is chosen and BOTH branches are skipped,
        # rather than a branch firing on a guess.
        self.assertEqual(res["status"]["x"], "skipped")
        self.assertEqual(res["status"]["y"], "skipped")

    def test_verify_majority_refutes(self):
        stub = Stub(replies={"codex": "finding: token in logs",
                             "grok": "VERDICT: refuted\nREASON: the log line is redacted"})
        s = spec([
            {"id": "find", "provider": "codex", "prompt": "x"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["find"],
             "voters": 3, "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        rec = [t for t in res["transcript"] if t["node"] == "v"][0]
        self.assertEqual(rec["verdict"], "refuted")
        self.assertEqual(rec["voters"], 3)

    def test_verify_survives_when_skeptics_cannot_refute(self):
        stub = Stub(replies={"codex": "finding",
                             "grok": "VERDICT: survives\nREASON: reproduced it"})
        s = spec([
            {"id": "find", "provider": "codex", "prompt": "x"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["find"],
             "voters": 3, "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual([t for t in res["transcript"] if t["node"] == "v"][0]["verdict"],
                         "survives")

    def test_router_refuses_an_ambiguous_reply(self):
        # names BOTH targets: picking the first would be a coin flip presented
        # as a decision.
        stub = Stub(replies={"codex": "this is not a quick change, run the audit"})
        s = spec([
            {"id": "r", "kind": "route", "provider": "codex",
             "targets": ["quick", "audit"], "prompt": "classify"},
            {"id": "quick", "provider": "grok", "deps": ["r"], "prompt": "go"},
            {"id": "audit", "provider": "grok", "deps": ["r"], "prompt": "go"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["status"]["quick"], "skipped")
        self.assertEqual(res["status"]["audit"], "skipped")

    def test_router_accepts_an_unambiguous_named_target(self):
        stub = Stub(replies={"codex": "run the audit, this touches payments"})
        s = spec([
            {"id": "r", "kind": "route", "provider": "codex",
             "targets": ["quick", "audit"], "prompt": "classify"},
            {"id": "quick", "provider": "grok", "deps": ["r"], "prompt": "go"},
            {"id": "audit", "provider": "grok", "deps": ["r"], "prompt": "go"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["status"]["audit"], "returned")
        self.assertEqual(res["status"]["quick"], "skipped")

    def test_degraded_verifier_panel_does_not_go_soft(self):
        """1 of 3 skeptics returns and refutes. Holding it to a full-panel
        majority would report a finding as having survived scrutiny it never
        received."""
        calls = {"n": 0}

        def flaky(_prompt):
            calls["n"] += 1
            return "VERDICT: refuted\nREASON: the log line is redacted" if calls["n"] == 1 else None

        stub = Stub(replies={"codex": "finding", "grok": flaky})
        s = spec([
            {"id": "f", "provider": "codex", "prompt": "x"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["f"],
             "voters": 3, "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        rec = [t for t in res["transcript"] if t["node"] == "v"][0]
        self.assertEqual(rec["verdict"], "refuted")
        self.assertEqual(rec["returned_voters"], 1)
        self.assertIn("DEGRADED PANEL", rec["text"])

    def test_explicit_threshold_is_absolute(self):
        stub = Stub(replies={"codex": "finding",
                             "grok": "VERDICT: refuted\nREASON: nope"})
        s = spec([
            {"id": "f", "provider": "codex", "prompt": "x"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["f"],
             "voters": 3, "threshold": 3, "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual([t for t in res["transcript"] if t["node"] == "v"][0]["threshold"], 3)

    def test_verifiers_get_different_lenses(self):
        stub = Stub(replies={"codex": "f", "grok": "VERDICT: survives"})
        s = spec([
            {"id": "f", "provider": "codex", "prompt": "x"},
            {"id": "v", "kind": "verify", "provider": "grok", "deps": ["f"],
             "voters": 3, "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            G.run("t", spec=s)
        lenses = {c["prompt"].split("Your lens:")[1].split("\n")[0].strip()
                  for c in stub.calls if "Your lens:" in c["prompt"]}
        self.assertEqual(len(lenses), 3, "identical skeptics miss identical things")

    def test_reduce_dedupes_without_a_model_call(self):
        stub = Stub(replies={"codex": "- leaks memory\n- slow startup",
                             "grok": "- Leaks memory!\n- flaky test"})
        s = spec([
            {"id": "a", "provider": "codex", "prompt": "x"},
            {"id": "b", "provider": "grok", "prompt": "x"},
            {"id": "m", "kind": "reduce", "op": "dedupe", "deps": ["a", "b"]},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(len(stub.calls), 2)          # the merge cost nothing
        self.assertEqual(len(res["final"]["m"].splitlines()), 3)

    def test_human_gate_halts_until_approved(self):
        stub = Stub()
        s = spec([
            {"id": "w", "provider": "codex", "prompt": "x"},
            {"id": "h", "kind": "human", "deps": ["w"], "reason": "publishes to prod"},
            {"id": "after", "provider": "grok", "deps": ["h"], "prompt": "{{inputs}}"},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["needs_approval"], ["h"])
        self.assertEqual(res["status"]["after"], "skipped")
        with patched(Stub()) as s2:
            res2 = G.run("t", spec=s, approve="h")
        self.assertEqual(res2["needs_approval"], [])
        self.assertEqual(res2["status"]["after"], "returned")
        self.assertEqual(len(s2.calls), 2)

    def test_gate_result_is_recorded(self):
        stub = Stub()
        s = spec([
            {"id": "w", "provider": "codex", "prompt": "x"},
            {"id": "g", "kind": "gate", "cmd": "exit 1", "deps": ["w"]},
        ])
        with patched(stub):
            res = G.run("t", spec=s)
        rec = [t for t in res["transcript"] if t["node"] == "g"][0]
        self.assertFalse(rec["gate"]["passed"])
        self.assertEqual(res["status"]["g"], "error")

    def test_lint_errors_block_dispatch(self):
        stub = Stub()
        s = spec([{"id": "a", "deps": ["ghost"]}])
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertFalse(res["ran"])
        self.assertTrue(res["blocked_by_lint"])
        self.assertEqual(stub.calls, [])

    def test_plan_mode_never_dispatches(self):
        stub = Stub()
        s = spec([{"id": "a", "provider": "codex", "prompt": "x"}])
        with patched(stub):
            res = G.run("t", spec=s, dry_run=True)
        self.assertFalse(res["ran"])
        self.assertEqual(stub.calls, [])
        self.assertIn("critical_path", res["plan"])

    def test_call_budget_blocks_before_spending(self):
        stub = Stub()
        s = spec([{"id": "w", "provider": "codex", "for_each": list("abcdef"),
                   "prompt": "x"}], budget={"max_calls": 3})
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertFalse(res["ran"])           # the estimate refuses up front
        self.assertEqual(stub.calls, [])

    def test_per_node_model_tiering_reaches_dispatch(self):
        stub = Stub()
        s = spec([
            {"id": "cheap", "provider": "opencode", "model": "glm-lite", "prompt": "x"},
            {"id": "smart", "provider": "codex", "model": "gpt-5.5", "effort": "xhigh",
             "deps": ["cheap"], "prompt": "{{cheap}}"},
        ])
        with patched(stub):
            G.run("t", spec=s)
        by_prov = {c["provider"]: c for c in stub.calls}
        self.assertEqual(by_prov["opencode"]["model"], "glm-lite")
        self.assertEqual(by_prov["codex"]["effort"], "xhigh")


# --- loop until dry ---------------------------------------------------------

class TestLoopUntilDry(unittest.TestCase):
    def test_stops_when_rounds_go_dry(self):
        stub = Stub(replies={"codex": "- the same finding every time"})
        s = spec([{"id": "find", "provider": "codex", "prompt": "{{seen}} {{round}}"}],
                 repeat={"max_rounds": 4, "stop_after_dry_rounds": 1})
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["rounds_run"], 2)     # round 1 novel, round 2 dry -> stop
        self.assertEqual(res["rounds"][0]["new_items"], 1)
        self.assertEqual(res["rounds"][1]["new_items"], 0)

    def test_keeps_going_while_new_findings_appear(self):
        counter = {"n": 0}

        def fresh(_prompt):
            counter["n"] += 1
            return f"- brand new finding number {counter['n']}"

        stub = Stub(replies={"codex": fresh})
        s = spec([{"id": "find", "provider": "codex", "prompt": "{{seen}}"}],
                 repeat={"max_rounds": 3, "stop_after_dry_rounds": 2})
        with patched(stub):
            res = G.run("t", spec=s)
        self.assertEqual(res["rounds_run"], 3)

    def test_dedupe_is_against_everything_seen(self):
        seen = set()
        self.assertEqual(len(G.novel_items("- alpha finding here\n- beta finding here", seen)), 2)
        # a rejected item must not reappear as novel next round
        self.assertEqual(G.novel_items("- Alpha finding here!", seen), [])

    def test_seen_set_is_injected_into_the_prompt(self):
        prompts = []
        stub = Stub(replies={"codex": lambda p: (prompts.append(p), "- new one " + str(len(prompts)))[1]})
        s = spec([{"id": "f", "provider": "codex", "prompt": "already seen:\n{{seen}}"}],
                 repeat={"max_rounds": 2, "stop_after_dry_rounds": 2})
        with patched(stub):
            G.run("t", spec=s)
        self.assertIn("new one 1", prompts[1])


# --- backwards compatibility ------------------------------------------------

class TestDSL(unittest.TestCase):
    def test_legacy_nodes_edges_dsl_still_runs(self):
        stub = Stub()
        with patched(stub):
            res = G.run("t", nodes="r=codex,a=copilot,m=grok",
                        edges="r>a,r>m,a>m")
        self.assertTrue(res["ran"])
        self.assertEqual(res["sinks"], ["m"])
        self.assertEqual(len(stub.calls), 3)

    def test_kind_can_be_declared_inline(self):
        s = G.nodes_from_dsl("a=codex,v=grok:verify,m=:reduce", "a>v,v>m")
        kinds = {n.id: n.kind for n in s}
        self.assertEqual(kinds, {"a": "work", "v": "verify", "m": "reduce"})

    def test_keyword_aliases_from_vendored_callers(self):
        stub = Stub()
        with patched(stub):
            res = G.run("t", nodes_spec="a=codex", edges_spec="")
        self.assertTrue(res["ran"])

    def test_parse_helpers_preserved(self):
        self.assertEqual(G.parse_nodes("a=codex,b=grok"), {"a": "codex", "b": "grok"})
        self.assertEqual(G.parse_edges("a>b,b>c"), [("a", "b"), ("b", "c")])


# --- knowledge graph --------------------------------------------------------

def _kg(tmp):
    kg = K.KGraph("test", root=tmp)
    kg.declare_entity_type("Decision", "an ADR")
    kg.declare_entity_type("Incident", "a failure")
    kg.declare_entity_type("Component", "a service")
    kg.declare_entity_type("Person", "a human")
    kg.declare_relation("SUPERSEDES", "Decision", "Decision", inverse="SUPERSEDED_BY")
    kg.declare_relation("SUPERSEDED_BY", "Decision", "Decision", inverse="SUPERSEDES")
    kg.declare_relation("CAUSED_BY", "Incident", "Decision")
    kg.declare_relation("AFFECTS", "Decision", "Component")
    kg.declare_relation("DECIDED_BY", "Decision", "Person")
    return kg


class TestKnowledgeGraph(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fusion-kg-")
        self.kg = _kg(self.tmp)

    def test_vague_relation_is_rejected(self):
        errs = self.kg.declare_relation("RELATED_TO", "Decision", "Person")
        self.assertTrue(any("vague" in e for e in errs))
        self.assertNotIn("RELATED_TO", self.kg.relation_types())

    def test_unknown_entity_type_fails_closed(self):
        with self.assertRaises(ValueError):
            self.kg.add_entity("Thing", "some blob")

    def test_domain_range_violation_is_rejected_in_code(self):
        d = self.kg.add_entity("Decision", "ADR-007")["id"]
        c = self.kg.add_entity("Component", "payments-api")["id"]
        with self.assertRaises(ValueError):
            self.kg.add_edge(d, "SUPERSEDES", c)     # range is Decision, not Component

    def test_relation_extraction_cannot_invent_entities(self):
        d = self.kg.add_entity("Decision", "ADR-007")["id"]
        with self.assertRaises(ValueError):
            self.kg.add_edge(d, "AFFECTS", "Component:ghost")

    def test_multi_hop_path_is_the_answer_skeleton(self):
        a = self.kg.add_entity("Decision", "ADR-007 Postgres queue", source="adr")["id"]
        b = self.kg.add_entity("Decision", "ADR-003 Redis queue", source="adr")["id"]
        i = self.kg.add_entity("Incident", "INC-2026-03-11", source="pager")["id"]
        self.kg.add_edge(a, "SUPERSEDES", b, source="adr", evidence="ADR-007 replaces ADR-003")
        self.kg.add_edge(i, "CAUSED_BY", b, source="postmortem", evidence="Redis eviction")
        path = self.kg.path(a, i)
        self.assertEqual([s["rel"] for s in path], ["SUPERSEDES", "CAUSED_BY"])

    def test_superseded_fact_is_closed_not_deleted(self):
        d1 = self.kg.add_entity("Decision", "ADR-1", source="s")["id"]
        d2 = self.kg.add_entity("Decision", "ADR-2", source="s")["id"]
        c = self.kg.add_entity("Component", "queue", source="s")["id"]
        e1 = self.kg.add_edge(d1, "AFFECTS", c, source="s", valid_from="2024-01-01")
        self.kg.add_edge(d2, "AFFECTS", c, source="s", valid_from="2026-01-01")
        self.kg.supersede(e1["id"], f"{d2}|AFFECTS|{c}", at="2026-01-01")
        self.assertEqual(len(self.kg.edges), 2)                     # nothing lost
        self.assertEqual(len(self.kg.active_edges()), 1)            # one current
        # ... and the graph can still answer "what was true in 2025"
        as_of = [e["head"] for e in self.kg.active_edges(as_of="2025-06-01")]
        self.assertIn(d1, as_of)

    def test_two_sources_saying_one_name_are_two_mentions_not_one_entity(self):
        """Collapsing them at write time IS an automatic erroneous merge."""
        p1 = self.kg.add_entity("Person", "J. Smith", source="a")["id"]
        p2 = self.kg.add_entity("Person", "J. Smith", source="b")["id"]
        self.assertNotEqual(p1, p2)
        self.assertEqual(self.kg.add_entity("Person", "J. Smith", source="a")["id"], p1)

    def test_structure_layer_separates_same_name_different_people(self):
        p1 = self.kg.add_entity("Person", "J. Smith", source="a")["id"]
        p2 = self.kg.add_entity("Person", "J. Smith", source="b")["id"]
        d1 = self.kg.add_entity("Decision", "ADR-1", source="a")["id"]
        self.kg.add_edge(d1, "DECIDED_BY", p1, source="a")
        m = self.kg.match_score(p1, p2)
        self.assertEqual(m["layers"]["string"], 1.0)
        self.assertEqual(m["layers"]["structure"], 0.0)
        # identical names but disjoint neighborhoods -> adjudicate, never auto-merge
        self.assertEqual(m["band"], "review")

    def test_conflicting_attributes_push_a_pair_out_of_auto_merge(self):
        a = self.kg.add_entity("Person", "Sam Lee", attrs={"email": "sam@a.com"}, source="a")["id"]
        b = self.kg.add_entity("Person", "Sam Lee", attrs={"email": "other@b.com"}, source="b")["id"]
        m = self.kg.match_score(a, b)
        self.assertTrue(m["layers"]["conflict"])
        self.assertNotEqual(m["band"], "merge")

    def test_merge_rewires_edges_and_stays_undoable(self):
        keep = self.kg.add_entity("Component", "Southeast University Service",
                                  source="a", aliases=["SEU Service"])["id"]
        drop = self.kg.add_entity("Component", "SEU Service", source="b")["id"]
        d = self.kg.add_entity("Decision", "ADR-9", source="a")["id"]
        self.kg.add_edge(d, "AFFECTS", drop, source="b")
        res = self.kg.merge(keep, drop)
        self.assertEqual(res["edges_rewired"], 1)
        self.assertNotIn(drop, self.kg.entities)
        self.assertEqual(self.kg.entities[keep]["merged_from"][0]["id"], drop)
        self.assertEqual(self.kg.edges[f"{d}|AFFECTS|{keep}"]["tail"], keep)

    def test_blocking_finds_acronym_duplicates(self):
        self.kg.add_entity("Component", "Southeast University Service", source="a")
        self.kg.add_entity("Component", "SUS", source="b")
        pairs = self.kg.candidates()
        self.assertTrue(pairs, "acronym expansion should block these together")

    def test_lint_catches_unfused_duplicates_and_missing_provenance(self):
        self.kg.add_entity("Decision", "ADR-7")
        self.kg.add_entity("Decision", "adr-7", source="b")
        codes = {i["code"] for i in self.kg.lint()}
        self.assertIn("no_provenance", codes)

    def test_lint_catches_contradiction_cycle(self):
        a = self.kg.add_entity("Decision", "A", source="s")["id"]
        b = self.kg.add_entity("Decision", "B", source="s")["id"]
        self.kg.add_edge(a, "SUPERSEDES", b, source="s")
        self.kg.add_edge(b, "SUPERSEDES", a, source="s")
        codes = {i["code"] for i in self.kg.lint()}
        self.assertIn("contradiction_cycle", codes)

    def test_lint_catches_missing_inverse(self):
        self.kg.ontology["relations"]["ORPHAN_REL"] = {
            "domain": "Decision", "range": "Person", "inverse": "NOT_DECLARED"}
        codes = {i["code"] for i in self.kg.lint()}
        self.assertIn("missing_inverse", codes)

    def test_ingest_rejects_bad_structure_instead_of_coercing(self):
        payload = {
            "entities": [{"type": "Decision", "name": "ADR-11", "confidence": 0.9},
                         {"type": "Wormhole", "name": "nope"}],
            "relations": [{"head": "ADR-11", "rel": "SUPERSEDES", "tail": "ADR-11"},
                          {"head": "ADR-11", "rel": "TELEPORTS_TO", "tail": "ADR-11"}],
        }
        res = K.ingest(self.kg, payload, source="doc-1")
        self.assertEqual(len(res["entities_added"]), 1)
        whys = " ".join(r["why"] for r in res["rejected"])
        self.assertIn("Wormhole", whys)
        self.assertIn("TELEPORTS_TO", whys)

    def test_ingest_stamps_provenance_on_every_fact(self):
        K.ingest(self.kg, {"entities": [{"type": "Decision", "name": "ADR-12"}],
                           "relations": []}, source="doc-9", extracted_at="2026-07-28")
        e = self.kg.entities["Decision:adr_12"]
        self.assertEqual(e["source"], "doc-9")
        self.assertEqual(e["extracted_at"], "2026-07-28")

    def test_identifiers_inside_a_sentence_still_link(self):
        """A missed link silently downgrades a multi-hop question into a
        one-hop neighborhood, so contained mentions must resolve."""
        a = self.kg.add_entity("Decision", "ADR-003 Redis queue", source="s")["id"]
        i = self.kg.add_entity("Incident", "INC-2026-03-11", source="s")["id"]
        self.kg.add_edge(i, "CAUSED_BY", a, source="s")
        out = self.kg.answer_context(
            "Why did we drop the ADR-003 Redis queue, and what did INC-2026-03-11 do?")
        self.assertEqual(set(out["seeds"]), {a, i})
        self.assertIn("multi-hop", out["recommendation"])

    def test_retrieval_says_when_the_graph_is_the_wrong_tool(self):
        out = self.kg.answer_context("what is the airspeed of an unladen swallow")
        self.assertIn("not the graph", out["recommendation"])

    def test_serialize_carries_type_and_provenance(self):
        d = self.kg.add_entity("Decision", "ADR-7", source="adr")["id"]
        c = self.kg.add_entity("Component", "queue", source="adr")["id"]
        self.kg.add_edge(d, "AFFECTS", c, source="adr-7.md", confidence=0.8)
        text = self.kg.serialize()
        self.assertIn("-[AFFECTS]->", text)
        self.assertIn("src=adr-7.md", text)
        self.assertIn("conf=0.8", text)

    def test_round_trip_persistence(self):
        self.kg.add_entity("Decision", "ADR-42", source="s")
        self.kg.save()
        again = K.KGraph("test", root=self.tmp).load()
        self.assertIn("Decision:adr_42", again.entities)
        self.assertIn("SUPERSEDES", again.relation_types())


if __name__ == "__main__":
    unittest.main(verbosity=2)
