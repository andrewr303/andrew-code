/**
 * `agentLifecycle` domain — builtin agent profile contributions.
 *
 * Registers the default `agent` profile plus the `coder` / `explore` task-agent
 * profiles. Each profile is self-contained: its structured `renderSystemPrompt`
 * merges the shared base template with its own role text at call time, so a
 * child agent no longer inherits the parent's prompt through a runtime overlay.
 */

import { collectGitContext } from './gitContext';
import { registerAgentProfile } from '#/app/agentProfileCatalog/contribution';
import {
  renderSystemPromptResult,
  skillActiveFor,
  TASK_AGENT_ROLE_PREFIX,
} from '#/app/agentProfileCatalog/profile-shared';

import EXPLORE_ROLE from './explore-overlay.md?raw';
import SUMMARY_CONTINUATION_PROMPT from './summary-continuation.md?raw';

const AGENT_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'Bash',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'CronCreate',
  'CronList',
  'CronDelete',
  'ReadMediaFile',
  'TodoList',
  'Skill',
  'WebSearch',
  'Agent',
  'AgentSwarm',
  'Fusion',
  'AcpPeer',
  'exec',
  'wait',
  'FetchURL',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'mcp__*',
] as const;

const CODER_TOOLS = [
  'Agent',
  'AgentSwarm',
  'Fusion',
  'AcpPeer',
  'exec',
  'wait',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'Read',
  'ReadMediaFile',
  'Skill',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TodoList',
  'WebSearch',
  'FetchURL',
  'Write',
  'mcp__*',
] as const;

const EXPLORE_TOOLS = [
  'Bash',
  'Read',
  'ReadMediaFile',
  'Glob',
  'Grep',
  'WebSearch',
  'FetchURL',
] as const;

const EVALUATOR_TOOLS = [
  'Bash',
  'Read',
  'ReadMediaFile',
  'Glob',
  'Grep',
  'WebSearch',
  'FetchURL',
] as const;

const EVALUATOR_ROLE =
  'You are now running as a subagent. All the `user` messages are sent by the main agent. The main agent cannot see your context, it can only see your last message when you finish the task. You must treat the parent agent as your caller. Do not directly ask the end user questions. If something is unclear, explain the ambiguity in your final summary to the parent agent.\n\n' +
  'You are a skeptical second-opinion reviewer. You are reviewing work that a separate builder agent just claimed is complete. You did not see how it was built and you must not trust the builder\'s own assessment.\n\n' +
  'Do the following every time:\n\n' +
  '1. Read the spec or acceptance criteria for the feature under review (PROGRESS.md, the prompt, or the named criteria).\n' +
  '2. Run `git diff` / `git log` against the baseline to see exactly what changed.\n' +
  '3. Open every screenshot, console log, or evidence file the builder cited. If a file fails to open or returns an error, treat it as missing evidence.\n' +
  '4. Decide.\n\n' +
  'Plausibility is not correctness. A reasonable-looking diff paired with missing or contradictory evidence is NEEDS_WORK. Missing evidence for any acceptance criterion is NEEDS_WORK. If you find yourself assuming something probably works, stop and look for proof.\n\n' +
  'Begin your reply with the bare word `PASS` or `NEEDS_WORK` on its own line, with nothing before it. Then:\n\n' +
  '- `PASS`: one line stating what evidence convinced you.\n' +
  '- `NEEDS_WORK`: a bullet list of specific, fixable findings the builder can act on next session.\n\n' +
  'You have no Write/Edit tools. Use Bash only for read-only inspection (`git diff`, `git log`, `ls`, tests that do not mutate the tree). Do not offer to fix anything yourself.';

const CODER_ROLE =
  `${TASK_AGENT_ROLE_PREFIX}\n\n` +
  'Your final message is the entire handoff — the parent sees nothing else from your run. ' +
  'Make it technically complete: what you changed and why, the path of every file you touched, ' +
  'how you verified the change (tests or commands run, with results), and anything left undone ' +
  'or worth follow-up. A final message of only a sentence or two is treated as too brief and ' +
  'sent back to you for expansion, costing an extra turn.';

const DEFAULT_SUMMARY_POLICY = {
  minChars: 200,
  continuationPrompt: SUMMARY_CONTINUATION_PROMPT,
  retries: 1,
} as const;

registerAgentProfile({
  name: 'agent',
  description: 'Default agent',
  tools: AGENT_TOOLS,
  renderSystemPrompt: (context) =>
    renderSystemPromptResult('', context, { skillActive: skillActiveFor(AGENT_TOOLS) }),
});

registerAgentProfile({
  name: 'coder',
  description:
    'General software engineering agent — the only subagent type with file-editing tools; use it for any delegated task that must modify code.',
  whenToUse:
    'Use this agent for non-trivial software engineering work that may require reading files, editing code, running commands, and returning a compact but technically complete summary to the parent agent.',
  tools: CODER_TOOLS,
  renderSystemPrompt: (context) =>
    renderSystemPromptResult(CODER_ROLE, context, { skillActive: skillActiveFor(CODER_TOOLS) }),
  summaryPolicy: DEFAULT_SUMMARY_POLICY,
});

registerAgentProfile({
  name: 'explore',
  description: 'Fast codebase exploration with prompt-enforced read-only behavior.',
  whenToUse:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (e.g. "src/**/*.yaml"), search code for keywords (e.g. "database connection"), or answer questions about the codebase (e.g. "how does the auth module work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "thorough" for comprehensive analysis across multiple locations and naming conventions. Use this agent for any read-only exploration that will clearly require more than 3 search queries. Prefer launching multiple explore agents concurrently when investigating independent questions.',
  tools: EXPLORE_TOOLS,
  renderSystemPrompt: (context) =>
    renderSystemPromptResult(EXPLORE_ROLE, context, { skillActive: skillActiveFor(EXPLORE_TOOLS) }),
  promptPrefix: async ({ cwd, runner, log }) => {
    try {
      return await collectGitContext(runner, cwd, log);
    } catch {
      return '';
    }
  },
  summaryPolicy: DEFAULT_SUMMARY_POLICY,
});

registerAgentProfile({
  name: 'evaluator',
  description: 'Fresh-context, read-only reviewer that returns PASS or NEEDS_WORK with evidence — never grades its own build.',
  whenToUse:
    'Fresh-context evaluator for the long-running harness. Use after a coder subagent claims a feature is done: the evaluator has no write tools, never saw the build, and returns PASS or NEEDS_WORK with evidence. Also use whenever Default-FAIL requires an independent grade before flipping a criterion to true.',
  tools: EVALUATOR_TOOLS,
  renderSystemPrompt: (context) =>
    renderSystemPromptResult(EVALUATOR_ROLE, context, { skillActive: skillActiveFor(EVALUATOR_TOOLS) }),
  summaryPolicy: DEFAULT_SUMMARY_POLICY,
});
