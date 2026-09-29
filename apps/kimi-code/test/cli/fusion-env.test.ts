import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FUSION_PLUGIN_ROOT_ENV } from '#/constant/app';
import {
  installPackagedFusionPluginEnv,
  resolvePackagedFusionPluginDir,
} from '#/cli/fusion-env';

describe('fusion plugin environment setup', () => {
  const originalEnv = process.env[FUSION_PLUGIN_ROOT_ENV];

  beforeEach(() => {
    delete process.env[FUSION_PLUGIN_ROOT_ENV];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env[FUSION_PLUGIN_ROOT_ENV] = originalEnv;
    } else {
      delete process.env[FUSION_PLUGIN_ROOT_ENV];
    }
  });

  it('locates the packaged fusion-plugin directory', () => {
    const dir = resolvePackagedFusionPluginDir();
    expect(typeof dir).toBe('string');
    expect(dir?.endsWith('fusion-plugin')).toBe(true);
  });

  it('sets FUSION_PLUGIN_ROOT when unset and directory exists', () => {
    installPackagedFusionPluginEnv();
    expect(process.env[FUSION_PLUGIN_ROOT_ENV]).toBeDefined();
    expect(process.env[FUSION_PLUGIN_ROOT_ENV]?.endsWith('fusion-plugin')).toBe(true);
  });

  it('preserves FUSION_PLUGIN_ROOT when already set', () => {
    process.env[FUSION_PLUGIN_ROOT_ENV] = '/custom/fusion/root';
    installPackagedFusionPluginEnv();
    expect(process.env[FUSION_PLUGIN_ROOT_ENV]).toBe('/custom/fusion/root');
  });
});
