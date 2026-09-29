import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveFusionStateDir } from './paths';
import { resolveBashPath, resolveFusionScriptsRoot, which } from './scripts';
import type {
  ExternalCliAvailability,
  ExternalCliDetectResult,
  ExternalCliId,
  ExternalCliProbe,
} from './types';

const PANELIST_BINARIES: ReadonlyArray<{ id: ExternalCliId; binary: string }> = [
  { id: 'claude', binary: 'claude' },
  { id: 'codex', binary: 'codex' },
  { id: 'copilot', binary: 'copilot' },
  { id: 'opencode', binary: 'opencode' },
  { id: 'grok', binary: 'grok' },
  { id: 'kimi', binary: 'kimi' },
  { id: 'andrewcode', binary: 'andrewcode' },
];

function readDegradedSet(stateDir: string): ReadonlySet<string> {
  const path = join(stateDir, 'degraded-providers');
  if (!existsSync(path)) return new Set();
  try {
    const text = readFileSync(path, 'utf8');
    return new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
  } catch {
    return new Set();
  }
}

function resolveHost(): ExternalCliId | 'none' {
  const raw = (process.env['FUSION_HOST'] ?? 'andrewcode').trim().toLowerCase();
  if (raw === 'none' || raw === '') return 'none';
  if (
    raw === 'claude' ||
    raw === 'codex' ||
    raw === 'copilot' ||
    raw === 'opencode' ||
    raw === 'grok' ||
    raw === 'kimi' ||
    raw === 'andrewcode'
  ) {
    return raw;
  }
  return 'andrewcode';
}

function runDetectScriptSync(scriptsRoot: string): {
  providers?: Record<string, string>;
  metaloop?: Record<string, string>;
  live_panelists?: number;
  multi_model?: boolean;
} | undefined {
  const fusionScript = join(scriptsRoot, 'fusion.sh');
  if (!existsSync(fusionScript)) {
    return undefined;
  }
  try {
    const bash = resolveBashPath();
    const result = spawnSync(bash, [fusionScript, 'detect', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    if (result.status !== 0 || !result.stdout) {
      return undefined;
    }
    const text = result.stdout.trim();
    if (!text.startsWith('{')) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Probe installed coding CLIs for Fusion panel availability.
 *
 * Presence-only: does not round-trip auth. Live auth failures surface at
 * dispatch time and are recorded as `absent` / `error`.
 */
export function detectExternalClis(options?: {
  readonly homeDir?: string;
  readonly scriptsRoot?: string;
}): ExternalCliDetectResult {
  const host = resolveHost();
  const degraded = readDegradedSet(resolveFusionStateDir(options?.homeDir));
  const providers = {} as Record<ExternalCliId, ExternalCliProbe>;

  for (const { id, binary } of PANELIST_BINARIES) {
    let status: ExternalCliAvailability;
    let path: string | undefined;
    if (id === host) {
      status = 'host-native';
      path = which(binary);
    } else {
      path = which(binary);
      if (path === undefined) {
        status = 'missing';
      } else if (degraded.has(id)) {
        status = 'degraded';
      } else {
        status = 'available';
      }
    }
    providers[id] = { id, binary, status, path };
  }

  const scriptsRoot =
    options?.scriptsRoot ?? resolveFusionScriptsRoot({ homeDir: options?.homeDir });
  let metaloop: Record<string, string> | undefined;

  if (scriptsRoot) {
    const scriptDetect = runDetectScriptSync(scriptsRoot);
    if (scriptDetect && scriptDetect.providers) {
      for (const [idStr, scriptStatus] of Object.entries(scriptDetect.providers)) {
        const id = idStr as ExternalCliId;
        if (providers[id]) {
          providers[id] = {
            ...providers[id],
            status: scriptStatus as ExternalCliAvailability,
          };
        }
      }
      if (scriptDetect.metaloop) {
        metaloop = scriptDetect.metaloop;
      }
    }
  }

  let livePanelists = 0;
  for (const probe of Object.values(providers)) {
    if (probe.status === 'available') livePanelists += 1;
  }

  return {
    host,
    providers,
    livePanelists,
    multiModel: livePanelists >= 1,
    metaloop,
  };
}

/** Providers safe to fan out as external panelists (not host-native, not missing). */
export function listAvailablePanelists(
  detect: ExternalCliDetectResult = detectExternalClis(),
): ExternalCliId[] {
  return (Object.values(detect.providers) as ExternalCliProbe[])
    .filter((p) => p.status === 'available')
    .map((p) => p.id);
}
