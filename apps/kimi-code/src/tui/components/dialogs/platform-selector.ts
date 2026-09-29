import { OPEN_PLATFORMS } from '@moonshot-ai/kimi-code-oauth';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const PLATFORM_OPTIONS: readonly ChoiceOption[] = [
  { value: 'kimi-code', label: 'Kimi Code (membership OAuth)' },
  { value: 'codex', label: 'ChatGPT Codex (native OAuth)' },
  { value: 'xai', label: 'xAI Grok (OAuth)' },
  { value: 'xai-api-key', label: 'xAI Grok (API key)' },
  { value: 'claude', label: 'Claude Code (OAuth via claude CLI)' },
  { value: 'perplexity', label: 'Perplexity (session login)' },
  ...OPEN_PLATFORMS.map((platform) => ({ value: platform.id, label: platform.name })),
];

export interface PlatformSelectorOptions {
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...PLATFORM_OPTIONS],
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
