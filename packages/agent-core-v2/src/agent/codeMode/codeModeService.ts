import { IInstantiationService } from '#/_base/di/instantiation';
import { Service } from '#/_base/di/service';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IConfigService } from '#/app/config/config';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { MODELS_SECTION } from '#/app/kosongConfig/configSection';
import type { ModelsSection } from '#/kosong/model/model';

import { ANDREW_SECTION, type AndrewSection } from './configSection';
import { ICodeModeService } from './codeMode';
import { CodeModeRuntime, type CodeModeCell, type CodeModeToolResult } from './runtime';
import { parseCodeMode, resolveEffectiveCodeMode, type CodeMode } from './types';

export class CodeModeService extends Service implements ICodeModeService {
  declare readonly _serviceBrand: undefined;

  private readonly runtime = new CodeModeRuntime();

  constructor(
    @IConfigService private readonly configService: IConfigService,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IInstantiationService private readonly instantiation: IInstantiationService,
  ) {
    super();
    this.runtime.attach((name, args, signal) => this.dispatchTool(name, args, signal));
    this._register({ dispose: () => this.runtime.dispose() });
  }

  effectiveMode(): CodeMode {
    const andrew = this.configService.get<AndrewSection>(ANDREW_SECTION);
    const alias = this.profile.data().modelAlias;
    const models = this.configService.get<ModelsSection>(MODELS_SECTION) ?? {};
    const record = alias === undefined ? undefined : models[alias];
    return resolveEffectiveCodeMode({
      userPreference: andrew?.codeMode,
      modelRequirement: parseCodeMode(record?.['toolMode']),
    });
  }

  exec(
    source: string,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): Promise<CodeModeCell> {
    return this.runtime.exec(source, options);
  }

  wait(cellId: string, options?: { readonly timeoutMs?: number }): Promise<CodeModeCell> {
    return this.runtime.wait(cellId, options);
  }

  async dispatchTool(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<CodeModeToolResult> {
    if (name === 'exec' || name === 'wait') {
      return { name, result: `unknown or forbidden tool ${name}`, isError: true };
    }
    const tool = this.instantiation.invokeFunction((accessor) =>
      accessor.get(IAgentToolRegistryService).resolve(name),
    );
    if (tool === undefined) {
      return { name, result: `unknown or forbidden tool ${name}`, isError: true };
    }
    const execution = await tool.resolveExecution(args);
    if (!('execute' in execution)) {
      return {
        name,
        result: 'output' in execution ? execution.output : `tools.${name} rejected`,
        isError: true,
      };
    }
    const result = await execution.execute({
      turnId: 0,
      toolCallId: `code-mode-${name}`,
      signal: signal ?? new AbortController().signal,
    });
    return { name, result: result.output, isError: result.isError };
  }
}

registerScopedService(
  LifecycleScope.Agent,
  ICodeModeService,
  CodeModeService,
  ScopeActivation.OnDemand,
  'codeMode',
);
