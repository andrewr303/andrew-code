/**
 * `dap` domain — registers the `debug-dap` experimental flag into `flag`.
 *
 * Gates the real-debugger tool (DAP adapters: debugpy, lldb-dap, gdb, dlv).
 * Off by default — debuggee processes are heavy and privileged; enable
 * via `KIMI_CODE_EXPERIMENTAL_DEBUG_DAP`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const DEBUG_DAP_FLAG_ID = 'debug-dap';
export const DEBUG_DAP_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_DEBUG_DAP';

export const debugDapFlag: FlagDefinitionInput = {
  id: DEBUG_DAP_FLAG_ID,
  title: 'Real debugger (DAP) support',
  description:
    'Launch/attach debuggees through DAP adapters (debugpy, lldb-dap, gdb, dlv) with breakpoints, stepping, stack/variables inspection, and expression evaluation.',
  env: DEBUG_DAP_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(debugDapFlag);
