/**
 * `kernel` domain — `IKernelService` contract.
 *
 * Persistent code execution with a loopback tool bridge (oh-my-pi's
 * eval-kernel idea): named per-language sessions keep their globals across
 * calls, and Python cells can call back into the agent's own file tools —
 * `agent.read(path)`, `agent.glob(pattern)`, `agent.grep(pattern, path)` —
 * over the kernel's stdio bridge, answered synchronously by this service.
 * JavaScript cells run in the existing persistent Code Mode runtime via
 * `codeMode`; only Python spawns a child process (the `driver.py`
 * co-located with this feature). Kernels are Agent-scoped and disposed
 * with the agent; the child is killed, never orphaned. Bound at Agent
 * scope — contributed into every Agent scope by `KernelFeature`
 * (`features/kernel/kernelFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export type KernelLanguage = 'python' | 'javascript';

export interface KernelResult {
  readonly status: 'ok' | 'error';
  readonly output: string;
}

export interface IKernelService {
  readonly _serviceBrand: undefined;

  /** Run a code cell in a named persistent session (default per language). */
  run(language: KernelLanguage, code: string, session?: string): Promise<KernelResult>;

  /** Kill named sessions (or all when omitted). */
  reset(session?: string): Promise<void>;
}

export const IKernelService = createDecorator<IKernelService>('kernelService');
