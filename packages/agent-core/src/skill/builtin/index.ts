import type { SessionSkillRegistry } from '../registry';
import { BROWSER_SKILL } from './browser';
import { CHECK_KIMI_CODE_DOCS_SKILL } from './check-kimi-code-docs';
import { CUSTOM_THEME_SKILL } from './custom-theme';
import { FUSION_ORCHESTRATE_SKILL } from './fusion-orchestrate';
import { IMPORT_FROM_CC_CODEX_SKILL } from './import-from-cc-codex';
import { LONG_RUNNING_HARNESS_SKILL } from './long-running-harness';
import { MCP_CONFIG_SKILL } from './mcp-config';
import { RETRIEVE_SKILL } from './retrieve';
import {
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
} from './sub-skill';
import { UPDATE_CONFIG_SKILL } from './update-config';
import { WRITE_GOAL_SKILL } from './write-goal';

export function registerBuiltinSkills(registry: SessionSkillRegistry): void {
  registry.registerBuiltinSkill(MCP_CONFIG_SKILL);
  registry.registerBuiltinSkill(BROWSER_SKILL);
  registry.registerBuiltinSkill(IMPORT_FROM_CC_CODEX_SKILL);
  registry.registerBuiltinSkill(UPDATE_CONFIG_SKILL);
  registry.registerBuiltinSkill(CUSTOM_THEME_SKILL);
  registry.registerBuiltinSkill(WRITE_GOAL_SKILL);
  registry.registerBuiltinSkill(CHECK_KIMI_CODE_DOCS_SKILL);
  registry.registerBuiltinSkill(FUSION_ORCHESTRATE_SKILL);
  registry.registerBuiltinSkill(LONG_RUNNING_HARNESS_SKILL);
  registry.registerBuiltinSkill(RETRIEVE_SKILL);
  registry.registerBuiltinSkill(SUB_SKILL_PARENT);
  registry.registerBuiltinSkill(SUB_SKILL_REVIEW);
  registry.registerBuiltinSkill(SUB_SKILL_CONSOLIDATE);
}

export {
  BROWSER_SKILL,
  CHECK_KIMI_CODE_DOCS_SKILL,
  CUSTOM_THEME_SKILL,
  FUSION_ORCHESTRATE_SKILL,
  IMPORT_FROM_CC_CODEX_SKILL,
  LONG_RUNNING_HARNESS_SKILL,
  MCP_CONFIG_SKILL,
  RETRIEVE_SKILL,
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
  UPDATE_CONFIG_SKILL,
  WRITE_GOAL_SKILL,
};
