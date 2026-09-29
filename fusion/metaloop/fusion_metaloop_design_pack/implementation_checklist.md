# MetaLoop implementation checklist

## Phase 1 — proposal mode

- [ ] Add `fusion-metaloop` skill.
- [ ] Add `metaloop` command reference.
- [ ] Add `contracts.py` with strict dataclasses/enums/schema checks.
- [ ] Add `policy.py` with hard overrides before heuristic routing.
- [ ] Add `metaloop.py` state machine and dependency-wave dispatcher.
- [ ] Add `fable.sh` as a no-tools, structured-output advisor adapter.
- [ ] Add `agy.sh` with real capability detection.
- [ ] Add provider metadata for tier, family, harness, and strengths.
- [ ] Keep Fable outside worker panels and votes.
- [ ] Treat Agy/Copilot Gemini outputs as one correlation group.
- [ ] Add proposal-mode context capsules and patch/artifact results.
- [ ] Add per-task and final gates.
- [ ] Add bounded retry/promotion/takeover/advisor/stop transitions.
- [ ] Extend ledger events and provider iteration.
- [ ] Add offline unit tests and adapter syntax tests.
- [ ] Add optional live smoke tests.
- [ ] Update `README.md`, `CODEX.md`, collaboration-mode reference, and plugin metadata.
- [ ] Run `bash tests/validate.sh`.
- [ ] Run Python compilation and unit tests.

## Phase 2 — worktree mode

- [ ] Add base-commit freeze and dirty-tree guard.
- [ ] Create one task branch/worktree per write-capable task.
- [ ] Dispatch each worker into its isolated worktree.
- [ ] Require commit or patch plus receipts.
- [ ] Add integration worktree and GPT reconciliation flow.
- [ ] Add conflict log.
- [ ] Add full-gate rerun after integration.
- [ ] Add safe cleanup/recovery.

## Release gate

- [ ] No external worker can write to the user's main checkout.
- [ ] No overlapping worktree ownership.
- [ ] No fake two-vote Gemini consensus.
- [ ] No Fable call on routine subtasks.
- [ ] No unbounded repair or advisor loop.
- [ ] No destructive or production action without human approval.
- [ ] Exact model IDs, attempts, fallbacks, and gate receipts are visible in final audit.
