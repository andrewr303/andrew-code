/**
 * `codeMode` domain — persistent Codex-style JS runtime plus exposure policy.
 *
 * Bound at Agent scope. `exec` / `wait` inject this service; `toolSelect`
 * filters the model-visible tool list from `effectiveMode()`.
 */

import { createDecorator } from '#/_base/di/instantiation';
import type { CodeMode } from './types';
import type { CodeModeCell, CodeModeRuntime, CodeModeToolResult } from './runtime';

export interface ICodeModeService {
  readonly _serviceBrand: undefined;
  effectiveMode(): CodeMode;
  exec(
    source: string,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<CodeModeCell>;
  wait(cellId: string, options?: { readonly timeoutMs?: number }): Promise<CodeModeCell>;
  dispatchTool(name: string, args: unknown, signal?: AbortSignal): Promise<CodeModeToolResult>;
}

export const ICodeModeService = createDecorator<ICodeModeService>('codeModeService');

export type { CodeModeRuntime };
