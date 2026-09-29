# Fusion MetaLoop Design Pack

This pack contains an integration-ready architecture outline for adding a new `metaloop` swarm option to the attached Fusion Codex plugin.

## Contents

- `fusion_metaloop_swarm_outline.md` — complete design and repo integration plan.
- `implementation_checklist.md` — phased engineering checklist.
- `contracts/metaloop.schema.json` — proposed JSON Schema for task, worker, advisor, and gate contracts.
- `examples/run_record_example.json` — example ledger/audit record.
- `diagrams/*.svg` — scalable diagrams for docs and review.
- `diagrams/*.png` — rendered diagrams for quick viewing.
- `diagrams/*.dot` — editable Graphviz source.

## Recommended decision

Implement MetaLoop as a new explicit mode first, with proposal-mode workers and a maximum of two Fable advisor calls. Add worktree execution and auto-routing only after the contract and telemetry layer are proven.
