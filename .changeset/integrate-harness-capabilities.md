---
"@moonshot-ai/agent-core-v2": minor
"@moonshot-ai/kimi-code": minor
---

Add eight engine capabilities ported from the oh-my-pi / oh-my-openagent / FrontierAgent harnesses, each gated behind an experimental flag and a documented config section:

- Time-traveling stream rules (`stream-rules`): regex rules over streamed output that inject the rule body as a system reminder with a same-turn continuation; injections persist through the `streamRule.injected` wire record.
- Advisor second model (`[secondary_model]` pairing): a reviewer model reads each completed turn and injects aside/concern/blocker notes inline.
- Structured subagent yield: `Agent(output_schema=..., verify=true)` declares a JSON Schema the subagent validates through the new `Yield` tool; the parent reads the validated object directly, with an optional verification turn.
- Persistent kernel execution (`Kernel` tool): named long-lived Python sessions with `agent.read` / `agent.glob` / `agent.grep` callbacks from inside cells; JavaScript delegates to the Code Mode runtime.
- Hashline-anchored edits: `Read(hashline=true)` tags lines as `N#HH|content`; the `HashEdit` tool validates anchors and rejects stale references with fresh tags before any write.
- LSP-wired file rename (`RenameFile`): `workspace/willRenameFiles` runs first so a language server rewrites imports, re-exports, and barrel files before the move.
- Real debugger support (`Debug` tool): DAP adapters (debugpy, lldb-dap, gdb, dlv) with launch/attach, breakpoints, stepping, stack/scopes/variables inspection, and expression evaluation.
- Local Fusion (`Sidekick` tool, `[fusion]` section): a frontier lead pairs with a persistent cost-efficient sidekick; briefs exchange through handoffs (mid-handoff briefs inject into the running session), and compaction boundaries re-route which of the two models leads.
