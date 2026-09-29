import { createServer } from 'node:net';

import { findPwmBinary, PWM_BINARY_NAME } from './perplexity-session';

export const PERPLEXITY_BRIDGE_HOST = '127.0.0.1';
export const PERPLEXITY_BRIDGE_DEFAULT_PORT = 8080;
export const PERPLEXITY_BRIDGE_HEALTH_TIMEOUT_MS = 30_000;

export interface PerplexityBridgeHandle {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

export interface StartPerplexityBridgeOptions {
  readonly port?: number | undefined;
  readonly healthTimeoutMs?: number | undefined;
  readonly binaryPath?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly spawnImpl?: typeof import('node:child_process').spawn | undefined;
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, PERPLEXITY_BRIDGE_HOST, () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError !== undefined && closeError !== null) {
          reject(closeError);
          return;
        }
        if (address !== null && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('Could not determine a free loopback port.'));
      });
    });
  });
}

async function waitForHealthy(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    // Race each attempt against the remaining budget so a hung connection
    // cannot stall the loop past the deadline.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetchImpl(`${baseUrl}/health`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Health check attempt timed out')),
            Math.max(deadline - Date.now(), 1),
          );
        }),
      ]);
      if (response.ok) {
        const payload: unknown = await response.json().catch(() => undefined);
        const status =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)['status']
            : undefined;
        if (status === 'healthy') return;
        lastError = new Error(`Health check returned unexpected status: ${String(status)}`);
      } else {
        lastError = new Error(`Health check returned HTTP ${String(response.status)}`);
      }
    } catch (error) {
      lastError = error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for the Perplexity sidecar at ${baseUrl} to become healthy` +
      (lastError instanceof Error ? `: ${lastError.message}` : '.'),
  );
}

/**
 * Start the vendored `pwm api` sidecar on a loopback-only bind and wait until
 * `GET <baseUrl>/health` reports `{"status":"healthy"}`.
 *
 * The host is pinned to 127.0.0.1 — the sidecar itself refuses non-loopback
 * binds without `PWM_API_KEY`, and this bridge never passes one. Never logs
 * tokens: the bridge carries no credentials at all (the sidecar reads the
 * user's `~/.config/perplexity-web-mcp/token` itself).
 */
export async function startPerplexityBridge(
  options: StartPerplexityBridgeOptions = {},
): Promise<PerplexityBridgeHandle> {
  const binary = options.binaryPath ?? findPwmBinary();
  if (binary === undefined) {
    throw new Error(
      `The \`${PWM_BINARY_NAME}\` CLI was not found on PATH. Install it, then retry.`,
    );
  }
  const port = options.port ?? (await pickFreePort());
  const baseUrl = `http://${PERPLEXITY_BRIDGE_HOST}:${String(port)}`;
  const spawnImpl = options.spawnImpl ?? (await import('node:child_process')).spawn;
  let child: import('node:child_process').ChildProcess;
  try {
    child = spawnImpl(
      binary,
      ['api', '--host', PERPLEXITY_BRIDGE_HOST, '--port', String(port)],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: process.env,
      },
    );
  } catch (error) {
    throw new Error(
      `Failed to start \`${PWM_BINARY_NAME} api\`: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already exited.
        }
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  };
  const spawnError = await new Promise<Error | undefined>((resolve) => {
    child.once('error', (error: Error) => {
      resolve(error);
    });
    child.once('spawn', () => {
      resolve(undefined);
    });
    // `spawn` may fire on next tick; a synchronous failure surfaces via error.
    setImmediate(() => {
      if (child.exitCode !== null) resolve(new Error(`\`${PWM_BINARY_NAME} api\` exited immediately.`));
    });
  });
  if (spawnError !== undefined) {
    await stop();
    throw new Error(`Failed to start \`${PWM_BINARY_NAME} api\`: ${spawnError.message}`);
  }
  try {
    await waitForHealthy(
      baseUrl,
      options.healthTimeoutMs ?? PERPLEXITY_BRIDGE_HEALTH_TIMEOUT_MS,
      options.fetchImpl ?? fetch,
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return { baseUrl, stop };
}
