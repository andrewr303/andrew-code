/**
 * `stream-rules` domain — registers the `stream-rules` experimental flag into
 * `flag`.
 *
 * Gates time-traveling stream rules: regex triggers over streamed output that
 * abort course and inject the rule body as a system reminder. Off by default;
 * enable via `KIMI_CODE_EXPERIMENTAL_STREAM_RULES`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const STREAM_RULES_FLAG_ID = 'stream-rules';
export const STREAM_RULES_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_STREAM_RULES';

export const streamRulesFlag: FlagDefinitionInput = {
  id: STREAM_RULES_FLAG_ID,
  title: 'Time-traveling stream rules',
  description:
    'Match streamed model output against rules/*.md triggers and inject the matched rule body as a system reminder with a same-turn continuation.',
  env: STREAM_RULES_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(streamRulesFlag);
