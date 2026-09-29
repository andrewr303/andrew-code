import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export type SettingsSelection =
  | 'model'
  | 'theme'
  | 'editor'
  | 'permission'
  | 'experiments'
  | 'upgrade'
  | 'usage'
  | 'code-mode'
  | 'perplexity'
  | 'swarm';

const SETTINGS_OPTIONS: readonly ChoiceOption[] = [
  {
    value: 'model',
    label: 'Model',
    description: 'Switch the active model and thinking mode.',
  },
  {
    value: 'permission',
    label: 'Permission',
    description: 'Choose how tool actions are approved.',
  },
  {
    value: 'theme',
    label: 'Theme',
    description: 'Change the terminal UI theme.',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Set the external editor command.',
  },
  {
    value: 'experiments',
    label: 'Experiments',
    description: 'Turn experimental features on or off.',
  },
  {
    value: 'upgrade',
    label: 'Automatic updates',
    description: 'Turn automatic CLI updates on or off.',
  },
  {
    value: 'usage',
    label: 'Usage',
    description: 'Show session tokens, context window, and plan quotas.',
  },
  {
    value: 'code-mode',
    label: 'Code mode',
    description: 'Direct, mixed Code Mode, or Code Mode Only (Codex Sol/Terra require Only).',
  },
  {
    value: 'perplexity',
    label: 'Kimi web search fallback',
    description: 'Optional Perplexity Search API for Kimi Platform and Kimi Code only.',
  },
  {
    value: 'swarm',
    label: 'Swarm',
    description: 'Configure Fusion patterns, roles, and script forms (/swarm).',
  },
];

function isSettingsSelection(value: string): value is SettingsSelection {
  return (
    value === 'model' ||
    value === 'theme' ||
    value === 'editor' ||
    value === 'permission' ||
    value === 'experiments' ||
    value === 'upgrade' ||
    value === 'usage' ||
    value === 'code-mode' ||
    value === 'perplexity' ||
    value === 'swarm'
  );
}

export interface SettingsSelectorOptions {
  readonly onSelect: (value: SettingsSelection) => void;
  readonly onCancel: () => void;
}

export class SettingsSelectorComponent extends ChoicePickerComponent {
  constructor(opts: SettingsSelectorOptions) {
    super({
      title: 'Settings',
      options: [...SETTINGS_OPTIONS],
      onSelect: (value) => {
        if (isSettingsSelection(value)) opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
