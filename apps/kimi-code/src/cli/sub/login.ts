/**
 * `andrewcode login` — authenticate with isolated providers:
 * - Kimi Code OAuth (default)
 * - Kimi Platform API key (`kimi-platform`)
 * - ChatGPT Codex OAuth (`--codex` / `codex`)
 * - xAI Grok OAuth (`xai`) or API key (`xai --api-key`)
 * - Claude Code CLI OAuth (`claude`)
 * - Perplexity via the `pwm` sidecar (`perplexity`, optional `--base-url`)
 */

import { createInterface } from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';

import {
  applyCodexConfig,
  applyCodexAuthHeaders,
  applyPerplexityConfig,
  applyXaiConfig,
  applyXaiOAuthConfig,
  embedCodexModels,
  fetchCodexCatalog,
  hasPwmSession,
  loginCodex,
  loginXai,
  PERPLEXITY_BRIDGE_DEFAULT_PORT,
  pwmTokenPath,
  saveXaiApiKey,
} from '@moonshot-ai/kimi-code-oauth';
import { createKimiHarness } from '@moonshot-ai/kimi-code-sdk';

import {
  formatExternalAuthStatus,
  loginExternalCli,
  parseLoginTarget,
} from '#/cli/external-cli-auth';
import { createKimiCodeHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';

import { runLoginFlow } from './login-flow';

export function registerLoginCommand(parent: import('commander').Command): void {
  parent
    .command('login')
    .description(
      'Authenticate: Kimi Code OAuth (default), Kimi Platform, xAI, native Codex, Claude CLI, or Perplexity sidecar.',
    )
    .argument(
      '[target]',
      'Login target: kimi (default), kimi-platform, xai, claude, codex, or perplexity',
      'kimi',
    )
    .option('--status', 'Show Fusion panelists and isolated auth stores')
    .option('--codex', 'ChatGPT Codex OAuth (native, stored in ~/.andrewcode/codex-auth.json)')
    .option('--device-auth', 'Use the Codex device-code flow (headless / remote)')
    .option('--api-key', 'Use an xAI API key instead of Grok OAuth')
    .option(
      '--base-url <url>',
      'Perplexity sidecar base URL (default http://127.0.0.1:8080; or PWM_API_URL)',
    )
    .action(async (
      target: string,
      opts: {
        status?: boolean;
        codex?: boolean;
        deviceAuth?: boolean;
        apiKey?: boolean;
        baseUrl?: string;
      },
    ) => {
      if (opts.status === true) {
        process.stdout.write(`${formatExternalAuthStatus()}\n`);
        return;
      }

      if (opts.codex === true || target === '--codex') {
        await runNativeCodexLogin(opts.deviceAuth === true);
        return;
      }

      let parsed: ReturnType<typeof parseLoginTarget>;
      try {
        parsed = parseLoginTarget(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
      }

      if (parsed === 'kimi') {
        await runLoginFlow();
        return;
      }
      if (parsed === 'codex') {
        await runNativeCodexLogin(opts.deviceAuth === true);
        return;
      }
      if (parsed === 'xai') {
        if (opts.apiKey === true) await runXaiApiKeyLogin();
        await runXaiOAuthLogin();
        return;
      }
      if (parsed === 'kimi-platform') {
        process.stderr.write(
          'Use the TUI `/login` picker and choose a Kimi Platform host, or add the API key in Settings.\n',
        );
        process.exit(1);
      }
      if (parsed === 'perplexity') {
        await runPerplexityLogin(opts.baseUrl);
        return;
      }

      process.stderr.write(`Starting ${parsed} OAuth login via its CLI…\n`);
      const result = await loginExternalCli(parsed);
      process.stderr.write(`${result.message}\n`);
      process.exit(result.ok ? 0 : 1);
    });
}

async function runNativeCodexLogin(deviceAuth: boolean): Promise<never> {
  process.stderr.write(
    deviceAuth
      ? 'Starting ChatGPT Codex device-code login…\n'
      : 'Starting ChatGPT Codex OAuth…\n',
  );
  try {
    const credentials = await loginCodex({
      deviceAuth,
      openUrl,
      onProgress: (progress) => {
        process.stderr.write(`Open this URL if the browser does not open:\n  ${progress.authorizationUrl}\n`);
        if (progress.userCode !== undefined) {
          process.stderr.write(`Then enter this code: ${progress.userCode}\n`);
        }
      },
    });
    const catalog = await fetchCodexCatalog({ credentials, forceRefresh: true });
    const models = catalog.models.length > 0 ? catalog.models : embedCodexModels();
    const identity = createKimiCodeHostIdentity();
    const harness = createKimiHarness({ identity, uiMode: 'cli' });
    const config = await harness.getConfig();
    applyCodexConfig(config, models);
    applyCodexAuthHeaders(config, credentials);
    await harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    process.stderr.write(
      `Logged in to ChatGPT Codex${credentials.email !== undefined ? ` as ${credentials.email}` : ''}. Catalog: ${catalog.source} (${String(models.length)} models).\n`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Codex login failed: ${message}\n`);
    process.exit(1);
  }
}

async function runXaiOAuthLogin(): Promise<never> {
  process.stderr.write('Starting xAI Grok OAuth…\n');
  try {
    const identity = createKimiCodeHostIdentity();
    const harness = createKimiHarness({ identity, uiMode: 'cli' });
    const credentials = await loginXai({
      homeDir: harness.homeDir,
      openUrl,
      onProgress: (progress) => {
        process.stderr.write(
          `Open this URL:\n  ${progress.authorizationUrl}\nConfirm this code: ${progress.userCode}\n`,
        );
      },
    });
    const config = await harness.getConfig();
    applyXaiOAuthConfig(config);
    await harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    process.stderr.write(
      `Logged in to xAI Grok${credentials.refreshToken !== undefined ? ' with renewable OAuth credentials' : ''}.\n`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`xAI Grok login failed: ${message}\n`);
    process.exit(1);
  }
}

async function runXaiApiKeyLogin(): Promise<never> {
  const rl = createInterface({ input, output: output as NodeJS.WritableStream });
  try {
    const apiKey = (await rl.question('xAI API key: ')).trim();
    if (apiKey.length === 0) {
      process.stderr.write('No key entered.\n');
      process.exit(1);
    }
    saveXaiApiKey(apiKey);
    const identity = createKimiCodeHostIdentity();
    const harness = createKimiHarness({ identity, uiMode: 'cli' });
    const config = await harness.getConfig();
    applyXaiConfig(config, apiKey);
    await harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    process.stderr.write('xAI credentials saved to ~/.andrewcode/auth.json and models registered.\n');
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`xAI login failed: ${message}\n`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

function resolvePerplexityBaseUrl(explicitBaseUrl: string | undefined): string {
  const raw =
    explicitBaseUrl?.trim() ??
    process.env['PWM_API_URL']?.trim() ??
    `http://127.0.0.1:${String(PERPLEXITY_BRIDGE_DEFAULT_PORT)}`;
  return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function runInteractivePwmLogin(): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('pwm', ['login'], {
      stdio: 'inherit',
      windowsHide: false,
      env: process.env,
    });
    child.on('error', () => {
      resolve(null);
    });
    child.on('close', (code) => {
      resolve(code);
    });
  });
}

function verifyPwmSession(): boolean {
  // Prefer the sidecar's own check; fall back to token-file/env presence
  // when the binary cannot answer (e.g. older pwm without `login --check`).
  try {
    const check = spawnSync('pwm', ['login', '--check'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15_000,
    });
    if (check.status === 0) return true;
    if (check.status === 1) return false;
  } catch {
    // Fall through to the presence check below.
  }
  if (hasPwmSession()) return true;
  try {
    return existsSync(pwmTokenPath());
  } catch {
    return false;
  }
}

async function runPerplexityLogin(explicitBaseUrl: string | undefined): Promise<never> {
  process.stderr.write('Starting Perplexity login via the `pwm` sidecar…\n');
  if (!verifyPwmSession()) {
    const exitCode = await runInteractivePwmLogin();
    if (exitCode === null) {
      process.stderr.write('`pwm` was not found on PATH. Install the Perplexity sidecar, then re-run.\n');
      process.exit(1);
    }
    if (!verifyPwmSession()) {
      process.stderr.write(
        'Perplexity login did not complete (`pwm login --check` failed). Re-run `pwm login`, then retry.\n',
      );
      process.exit(1);
    }
  }
  const baseUrl = resolvePerplexityBaseUrl(explicitBaseUrl);
  try {
    const identity = createKimiCodeHostIdentity();
    const harness = createKimiHarness({ identity, uiMode: 'cli' });
    const config = await harness.getConfig();
    applyPerplexityConfig(config, baseUrl);
    await harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    process.stderr.write(
      `Perplexity session verified and models registered (sidecar ${baseUrl}). Start it with \`pwm api\` before chatting; daemon autostart is a follow-up.\n`,
    );
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Could not update config.toml: ${message} (your Perplexity session is fine — run \`andrewcode doctor config\` to find the broken section).\n`,
    );
    process.exit(1);
  }
}
