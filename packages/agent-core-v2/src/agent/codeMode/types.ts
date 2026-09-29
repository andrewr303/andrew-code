export type CodeMode = 'direct' | 'code_mode' | 'code_mode_only';

export const DIRECT_ONLY_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'Agent',
  'AgentSwarm',
  'Fusion',
  'AcpPeer',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'exec',
  'wait',
]);

export const CODE_MODE_TRANSPORT_TOOLS = new Set(['exec', 'wait']);

export function resolveEffectiveCodeMode(options: {
  readonly userPreference?: CodeMode;
  readonly modelRequirement?: CodeMode;
}): CodeMode {
  if (options.modelRequirement === 'code_mode_only') return 'code_mode_only';
  return options.userPreference ?? 'direct';
}

export function isDirectOnlyTool(name: string): boolean {
  return DIRECT_ONLY_TOOL_NAMES.has(name);
}

export function shouldExposeToolToModel(name: string, mode: CodeMode): boolean {
  if (mode === 'direct') return !CODE_MODE_TRANSPORT_TOOLS.has(name);
  if (mode === 'code_mode') return true;
  return isDirectOnlyTool(name);
}

export function parseCodeMode(value: unknown): CodeMode | undefined {
  if (value === 'direct' || value === 'code_mode' || value === 'code_mode_only') return value;
  return undefined;
}
