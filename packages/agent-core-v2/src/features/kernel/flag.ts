/**
 * `kernel` domain — registers the `kernel` experimental flag into `flag`.
 *
 * Gates persistent code execution with the loopback tool bridge (a
 * long-lived Python child plus the `Kernel` tool). Off by default; enable
 * via `KIMI_CODE_EXPERIMENTAL_KERNEL`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const KERNEL_FLAG_ID = 'kernel';
export const KERNEL_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_KERNEL';

export const kernelFlag: FlagDefinitionInput = {
  id: KERNEL_FLAG_ID,
  title: 'Persistent kernel execution with tool bridge',
  description:
    'Run code cells in named persistent sessions (python3 child, Code Mode runtime) with agent.read/glob/grep callbacks from inside Python.',
  env: KERNEL_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(kernelFlag);
