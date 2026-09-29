/**
 * `fusion` domain — registers the `fusion` experimental flag into `flag`.
 *
 * Gates Local Fusion: the lead + sidekick pairing with the `Sidekick`
 * handoff tool and compaction-boundary model routing. Off by default;
 * enable via `KIMI_CODE_EXPERIMENTAL_FUSION`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const FUSION_FLAG_ID = 'fusion';
export const FUSION_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_FUSION';

export const fusionFlag: FlagDefinitionInput = {
  id: FUSION_FLAG_ID,
  title: 'Local Fusion (lead + sidekick)',
  description:
    'Pair a frontier lead model with a cost-efficient sidekick: the Sidekick tool hands off mechanical work, and compaction boundaries re-route which model is in charge.',
  env: FUSION_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(fusionFlag);
