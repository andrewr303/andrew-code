"""Offline unit tests for Fusion MetaLoop (Phase 1). No CLIs, no network.

Run:  python -m unittest tests.test_metaloop      (from the plugin root)
  or: python tests/test_metaloop.py
"""
import os
import sys
import unittest

# Make ``fusion_swarm`` importable whether run from the plugin root or tests/.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm import contracts, policy, workspaces, metaloop  # noqa: E402
from fusion_swarm.contracts import (  # noqa: E402
    TaskSpec, WorkerResult, AdvisorMemo, GateResult, ContractError,
)


def _task(**kw):
    base = dict(
        id="T-1", objective="do a thing", category="test_implementation",
        acceptance_criteria=["works"], preferred_tier="fast", approval_level="none",
    )
    base.update(kw)
    return TaskSpec(**base)


# --- contracts --------------------------------------------------------------

class TestContracts(unittest.TestCase):
    def test_valid_taskspec(self):
        self.assertEqual(_task().validate(), [])

    def test_taskspec_score_out_of_range_fails(self):
        errs = _task(risk=5).validate()
        self.assertTrue(any("risk" in e for e in errs))

    def test_taskspec_bad_tier_fails_closed(self):
        errs = _task(preferred_tier="wizard").validate()
        self.assertTrue(any("preferred_tier" in e for e in errs))

    def test_taskspec_requires_acceptance_criteria(self):
        errs = _task(acceptance_criteria=[]).validate()
        self.assertTrue(any("acceptance_criteria" in e for e in errs))

    def test_taskspec_from_dict_rejects_unknown_field(self):
        with self.assertRaises(ContractError):
            TaskSpec.from_dict({"id": "T", "objective": "o", "category": "c",
                                "acceptance_criteria": ["a"], "bogus": 1})

    def test_valid_workerresult(self):
        wr = WorkerResult(task_id="T-1", provider="copilot", model="gemini-3.5-flash",
                          model_family="gemini", harness="github-copilot-cli", attempt=1,
                          status="returned", summary="done", confidence=0.9)
        self.assertEqual(wr.validate(), [])

    def test_workerresult_bad_status_fails_closed(self):
        wr = WorkerResult(task_id="T", provider="p", model="m", model_family="f",
                          harness="h", attempt=1, status="vibes", summary="s")
        self.assertTrue(any("status" in e for e in wr.validate()))

    def test_workerresult_confidence_range(self):
        wr = WorkerResult(task_id="T", provider="p", model="m", model_family="f",
                          harness="h", attempt=1, status="returned", summary="s",
                          confidence=1.5)
        self.assertTrue(any("confidence" in e for e in wr.validate()))

    def test_workerresult_attempt_min(self):
        wr = WorkerResult(task_id="T", provider="p", model="m", model_family="f",
                          harness="h", attempt=0, status="returned", summary="s")
        self.assertTrue(any("attempt" in e for e in wr.validate()))

    def test_valid_advisormemo(self):
        m = AdvisorMemo(decision="revise", plan_version=1, consult_reason="high_risk")
        self.assertEqual(m.validate(), [])

    def test_advisormemo_bad_decision_fails_closed(self):
        m = AdvisorMemo(decision="maybe", plan_version=1, consult_reason="x")
        self.assertTrue(any("decision" in e for e in m.validate()))

    def test_valid_gateresult(self):
        g = GateResult(gate_id="final", run_id="ml_1", status="pass")
        self.assertEqual(g.validate(), [])

    def test_gateresult_bad_status_fails_closed(self):
        g = GateResult(gate_id="final", run_id="ml_1", status="greenish")
        self.assertTrue(any("status" in e for e in g.validate()))


# --- routing ----------------------------------------------------------------

class TestRouting(unittest.TestCase):
    def test_security_routes_to_host(self):
        d = policy.route(_task(category="authz_change", risk=2))
        self.assertEqual(d.tier, "host")
        self.assertTrue(d.hard_override)

    def test_high_risk_host_triggers_advisor_preflight(self):
        d = policy.route(_task(category="database_migration", risk=3))
        self.assertEqual(d.tier, "host")
        self.assertTrue(d.advisor_preflight)

    def test_low_risk_repetitive_routes_fast(self):
        d = policy.route(_task(category="format_cleanup", risk=0, complexity=0,
                               latency_priority=3, verification_cmd="pytest -q"))
        self.assertEqual(d.tier, "fast")

    def test_large_context_refactor_routes_expert(self):
        d = policy.route(_task(category="broad_refactor", risk=2, complexity=3,
                               context_size=3, blast_radius=2, latency_priority=0))
        self.assertEqual(d.tier, "expert")

    def test_novel_task_routes_expert(self):
        d = policy.route(_task(category="novel_diagnosis", risk=2, complexity=2,
                               novelty=3, ambiguity=2, latency_priority=0))
        self.assertEqual(d.tier, "expert")

    def test_destructive_flags_human_approval(self):
        d = policy.route(_task(category="destructive_data_repair", risk=3,
                               approval_level="human_before_execute"))
        self.assertTrue(d.needs_human_approval)

    def test_expert_pressure_is_transparent(self):
        t = _task(risk=1, complexity=1, context_size=1)
        self.assertEqual(policy.expert_pressure(t),
                         2 * 1 + 2 * 1 + 1 + 0 + 0 + 0 - 0 - policy.verification_strength(t))


# --- correlation ------------------------------------------------------------

class TestCorrelation(unittest.TestCase):
    def test_two_gemini_harnesses_are_one_family(self):
        self.assertEqual(metaloop.count_model_families(["agy", "copilot"]), 1)

    def test_gemini_plus_grok_is_two_families(self):
        self.assertEqual(metaloop.count_model_families(["agy", "copilot", "grok"]), 2)

    def test_is_fake_consensus(self):
        self.assertTrue(metaloop.is_fake_consensus(["agy", "copilot"]))
        self.assertFalse(metaloop.is_fake_consensus(["agy", "grok"]))
        self.assertFalse(metaloop.is_fake_consensus(["copilot"]))

    def test_distinct_families_in_run_record(self):
        run = metaloop.new_run("x")
        for prov, fam, h in (("agy", "gemini", "antigravity-cli"),
                             ("copilot", "gemini", "github-copilot-cli"),
                             ("grok", "grok", "grok-build")):
            run.accept(WorkerResult(task_id=f"T-{prov}", provider=prov, model="m",
                                    model_family=fam, harness=h, attempt=1,
                                    status="returned", summary="s"))
        rec = run.to_run_record()
        self.assertEqual(rec["distinct_model_families"], 2)
        self.assertFalse(rec["absent_is_agreement"])

    def test_two_agy_sessions_are_one_family(self):
        # Fast tier = two Antigravity sessions on one Gemini model → one family.
        self.assertEqual(metaloop.count_model_families(["agy", "agy"]), 1)
        self.assertTrue(metaloop.is_fake_consensus(["agy", "agy"]))


# --- roster + CEO defaults --------------------------------------------------

class TestRosterAndCEO(unittest.TestCase):
    def test_copilot_is_not_a_metaloop_worker(self):
        from fusion_swarm import adapter
        self.assertNotIn("copilot", adapter.WORKER_PROVIDERS)
        self.assertEqual(adapter.WORKER_PROVIDERS, ["agy", "opencode", "grok"])

    def test_fast_tier_runs_two_agy_sessions(self):
        from fusion_swarm import adapter
        self.assertEqual(adapter.WORKER_SESSIONS.get("agy"), 2)
        self.assertEqual(adapter.PROVIDER_META["agy"]["tier"], "fast")

    def test_fable_default_policy_is_always(self):
        # Fable is the CEO: it frames every run first by default.
        self.assertEqual(metaloop.MetaLoopConfig().advisor_policy, "always")

    def test_advisormemo_tolerates_string_risk_findings(self):
        # Models often emit risk_findings as bare strings; ingestion normalizes them.
        m = AdvisorMemo.from_dict({
            "decision": "revise", "plan_version": 1, "consult_reason": "framing",
            "risk_findings": ["a bare string risk", {"finding": "already an object"}],
        }).check()
        self.assertTrue(all(isinstance(x, dict) for x in m.risk_findings))
        self.assertEqual(m.risk_findings[0], {"finding": "a bare string risk"})


# --- live worker-wave driver (offline, injected dispatch) -------------------

class TestWaveDriver(unittest.TestCase):
    def _reply(self, provider, status="returned"):
        from fusion_swarm.adapter import Reply
        body = '{"status":"returned","summary":"ok","confidence":0.9}'
        return Reply(provider, body if status == "returned" else "", status, status == "returned")

    def test_wave_dispatches_all_and_preserves_order(self):
        calls = []

        def fake_dispatch(provider, prompt, model="", effort="", timeout=None, repo=""):
            calls.append((provider, repo))
            return self._reply(provider)

        tasks = [
            (_task(id="F1", preferred_tier="fast"), "agy", "cap"),
            (_task(id="E1", preferred_tier="expert"), "opencode", "cap"),
            (_task(id="F2", preferred_tier="fast"), "agy", "cap"),
        ]
        out = metaloop.dispatch_worker_wave(tasks, repo="/some/repo", dispatch_fn=fake_dispatch)
        self.assertEqual([r["task_id"] for r in out], ["F1", "E1", "F2"])
        self.assertTrue(all(r["result"] is not None and r["failure"] == "" for r in out))
        self.assertTrue(all(repo == "/some/repo" for _, repo in calls))
        # two agy sessions dispatched
        self.assertEqual(sum(1 for p, _ in calls if p == "agy"), 2)

    def test_wave_reports_absent_worker_without_merging(self):
        def fake_dispatch(provider, prompt, model="", effort="", timeout=None, repo=""):
            return self._reply(provider, status="absent")

        out = metaloop.dispatch_worker_wave(
            [(_task(id="F1"), "agy", "cap")], dispatch_fn=fake_dispatch)
        self.assertIsNone(out[0]["result"])
        self.assertEqual(out[0]["failure"], metaloop.PROVIDER_ABSENT)


# --- state machine ----------------------------------------------------------

class TestStateMachine(unittest.TestCase):
    def test_valid_path(self):
        run = metaloop.new_run("x")
        for s in (metaloop.SNAPSHOTTED, metaloop.PLANNED_V1, metaloop.PLANNED_FINAL,
                  metaloop.DISPATCHING, metaloop.COLLECTING, metaloop.INTEGRATING,
                  metaloop.FINAL_GATE, metaloop.COMPLETED):
            run.transition(s)
        self.assertEqual(run.state, metaloop.COMPLETED)
        self.assertEqual(run.status, "completed")

    def test_illegal_transition_raises(self):
        run = metaloop.new_run("x")
        with self.assertRaises(metaloop.StateError):
            run.transition(metaloop.COMPLETED)  # can't jump from CREATED

    def test_terminal_is_frozen(self):
        run = metaloop.new_run("x")
        run.transition(metaloop.CANCELLED)
        with self.assertRaises(metaloop.StateError):
            run.transition(metaloop.SNAPSHOTTED)

    def test_events_are_appended(self):
        run = metaloop.new_run("x")
        n = len(run.events)
        run.transition(metaloop.SNAPSHOTTED)
        self.assertEqual(len(run.events), n + 1)


# --- dependency waves -------------------------------------------------------

class TestWaves(unittest.TestCase):
    def test_linear_chain(self):
        a = _task(id="A")
        b = _task(id="B", dependencies=["A"])
        c = _task(id="C", dependencies=["B"])
        self.assertEqual(metaloop.topological_waves([a, b, c]), [["A"], ["B"], ["C"]])

    def test_parallel_wave(self):
        a = _task(id="A")
        b = _task(id="B")
        c = _task(id="C", dependencies=["A", "B"])
        waves = metaloop.topological_waves([a, b, c])
        self.assertEqual(sorted(waves[0]), ["A", "B"])
        self.assertEqual(waves[1], ["C"])

    def test_cycle_raises(self):
        a = _task(id="A", dependencies=["B"])
        b = _task(id="B", dependencies=["A"])
        with self.assertRaises(ValueError):
            metaloop.topological_waves([a, b])

    def test_unknown_dependency_raises(self):
        a = _task(id="A", dependencies=["ghost"])
        with self.assertRaises(ValueError):
            metaloop.topological_waves([a])


# --- budgets + escalation ---------------------------------------------------

class TestEscalation(unittest.TestCase):
    def _run(self, **cfg):
        c = metaloop.MetaLoopConfig(**cfg)
        return metaloop.MetaLoopRun("ml_test", c)

    def test_malformed_gets_one_schema_repair_then_escalates(self):
        run = self._run()
        t = _task(risk=0, complexity=0, latency_priority=3, verification_cmd="pytest")
        run.note_attempt(t.id)  # attempt 1
        a1 = metaloop.next_action(metaloop.MALFORMED_OUTPUT, t, run)
        self.assertEqual(a1.kind, metaloop.SCHEMA_REPAIR)
        run.note_attempt(t.id)  # attempt 2
        a2 = metaloop.next_action(metaloop.MALFORMED_OUTPUT, t, run)
        self.assertNotEqual(a2.kind, metaloop.SCHEMA_REPAIR)

    def test_fast_verification_failure_promotes(self):
        run = self._run()
        t = _task(risk=0, complexity=0, latency_priority=3, verification_cmd="pytest")
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.VERIFICATION_FAILURE, t, run)
        self.assertEqual(a.kind, metaloop.PROMOTE)
        self.assertEqual(a.target_tier, "expert")

    def test_expert_failure_takeover(self):
        run = self._run()
        t = _task(id="E", category="broad_refactor", risk=2, complexity=3,
                  context_size=3, blast_radius=2, latency_priority=0)
        self.assertEqual(policy.route(t).tier, "expert")
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.VERIFICATION_FAILURE, t, run)
        self.assertEqual(a.kind, metaloop.HOST_TAKEOVER)

    def test_timeout_tries_alternate_worker(self):
        run = self._run()
        t = _task()
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.TIMEOUT, t, run)
        self.assertEqual(a.kind, metaloop.ALTERNATE_WORKER)

    def test_scope_violation_goes_to_host_review(self):
        run = self._run()
        t = _task()
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.SCOPE_VIOLATION, t, run)
        self.assertEqual(a.kind, metaloop.HOST_REVIEW)

    def test_plan_failure_consults_advisor_within_budget(self):
        run = self._run(max_advisor_calls=2)
        t = _task()
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.PLAN_FAILURE, t, run)
        self.assertEqual(a.kind, metaloop.ADVISOR_CONSULT)

    def test_plan_failure_stops_when_advisor_budget_spent(self):
        run = self._run(max_advisor_calls=1)
        run.note_advisor_call()  # spend it
        t = _task()
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.PLAN_FAILURE, t, run)
        self.assertEqual(a.kind, metaloop.STOP)

    def test_approval_required_pauses_for_human(self):
        run = self._run()
        a = metaloop.next_action(metaloop.APPROVAL_REQUIRED, _task(), run)
        self.assertEqual(a.kind, metaloop.HUMAN_APPROVAL)

    def test_attempt_cap_forces_stop(self):
        run = self._run(max_attempts_per_task=3)
        t = _task()
        for _ in range(3):
            run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.TIMEOUT, t, run)
        self.assertEqual(a.kind, metaloop.STOP)

    def test_call_budget_forces_stop(self):
        run = self._run(max_total_external_calls=2)
        for _ in range(2):
            run.note_external_call()
        t = _task()
        run.note_attempt(t.id)
        a = metaloop.next_action(metaloop.TIMEOUT, t, run)
        self.assertEqual(a.kind, metaloop.STOP)

    def test_advisor_budget_cannot_be_overspent(self):
        run = self._run(max_advisor_calls=1)
        self.assertTrue(run.note_advisor_call())
        self.assertFalse(run.note_advisor_call())


# --- advisor policy ---------------------------------------------------------

class TestAdvisorPolicy(unittest.TestCase):
    def test_off_never_triggers(self):
        trig, _ = metaloop.advisor_preflight_trigger([_task(risk=3)],
                                                      metaloop.MetaLoopConfig(advisor_policy="off"))
        self.assertFalse(trig)

    def test_always_triggers(self):
        trig, _ = metaloop.advisor_preflight_trigger([_task()],
                                                      metaloop.MetaLoopConfig(advisor_policy="always"))
        self.assertTrue(trig)

    def test_on_demand_does_not_auto_trigger(self):
        trig, _ = metaloop.advisor_preflight_trigger([_task(risk=3)],
                                                      metaloop.MetaLoopConfig(advisor_policy="on-demand"))
        self.assertFalse(trig)

    def test_auto_triggers_on_high_risk(self):
        trig, _ = metaloop.advisor_preflight_trigger(
            [_task(category="architecture", risk=3)],
            metaloop.MetaLoopConfig(advisor_policy="auto", risk_threshold=2))
        self.assertTrue(trig)

    def test_auto_quiet_on_low_risk(self):
        trig, _ = metaloop.advisor_preflight_trigger(
            [_task(risk=0, latency_priority=3, verification_cmd="pytest")],
            metaloop.MetaLoopConfig(advisor_policy="auto", risk_threshold=2))
        self.assertFalse(trig)


# --- workspace + scope gate -------------------------------------------------

class TestWorkspace(unittest.TestCase):
    def test_proposal_workspace_is_inert_and_safe(self):
        ws = workspaces.get_workspace(workspaces.PROPOSAL, base_commit="abc")
        desc = ws.prepare(_task())
        self.assertEqual(desc["mode"], "proposal")
        self.assertIsNone(desc["writable_checkout"])

    def test_worktree_mode_refuses_in_phase1(self):
        with self.assertRaises(NotImplementedError):
            workspaces.get_workspace(workspaces.WORKTREE)

    def test_scope_gate_flags_forbidden_path(self):
        t = _task(allowed_paths=["src/"], forbidden_paths=[".codex-plugin/plugin.json"])
        rep = workspaces.scope_gate(t, [".codex-plugin/plugin.json"])
        self.assertFalse(rep.ok)
        self.assertIn(".codex-plugin/plugin.json", rep.forbidden_hits)

    def test_scope_gate_flags_outside_allowed(self):
        t = _task(allowed_paths=["src/"])
        rep = workspaces.scope_gate(t, ["docs/readme.md"])
        self.assertFalse(rep.ok)
        self.assertIn("docs/readme.md", rep.outside_allowed)

    def test_scope_gate_accepts_in_scope(self):
        t = _task(allowed_paths=["src/", "tests/"])
        rep = workspaces.scope_gate(t, ["src/app.py", "tests/test_app.py"])
        self.assertTrue(rep.ok)

    def test_scope_gate_prefix_is_directory_aware(self):
        t = _task(allowed_paths=["src"])
        rep = workspaces.scope_gate(t, ["src-generated/x.py"])
        self.assertFalse(rep.ok)  # 'src-generated' is not under 'src'


# --- worker prompt + parse --------------------------------------------------

class TestWorkerIO(unittest.TestCase):
    def test_prompt_contains_spec_and_rules(self):
        p = metaloop.build_worker_prompt(_task(), "capsule text", tier="fast")
        self.assertIn("TASK_SPEC", p)
        self.assertIn("forbidden", p.lower())
        self.assertIn("WorkerResult", p)

    def test_parse_fenced_json(self):
        text = '```json\n{"status":"returned","summary":"ok","confidence":0.8}\n```'
        wr = metaloop.parse_worker_result(text, task_id="T-1", provider="copilot", attempt=1)
        self.assertEqual(wr.task_id, "T-1")
        self.assertEqual(wr.provider, "copilot")
        self.assertEqual(wr.model_family, "gemini")

    def test_parse_malformed_raises(self):
        with self.assertRaises(ContractError):
            metaloop.parse_worker_result("no json here", task_id="T", provider="copilot", attempt=1)

    def test_classify_absent_reply(self):
        from fusion_swarm.adapter import Reply
        self.assertEqual(metaloop.classify_worker_reply(Reply("agy", "", "absent", False)),
                         metaloop.PROVIDER_ABSENT)
        self.assertIsNone(metaloop.classify_worker_reply(Reply("agy", "ok", "returned", True)))


if __name__ == "__main__":
    unittest.main()
