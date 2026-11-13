#!/usr/bin/env node
/**
 * Remote Device Hub stdio bridge.
 *
 * DSH speaks MCP over stdio, while Remote Device Hub exposes a protected
 * Streamable HTTP endpoint that requires OAuth. This launcher validates the
 * configuration and runs the bridge in this process, so the DSH MCP client can
 * treat the service like a local stdio server.
 */

import { realpathSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { BridgeAuth } from './auth.mjs';
import { runBridge } from './bridge.mjs';
import { log } from './bridge-log.mjs';
import { DEFAULT_OAUTH_PORT, resolveConfig } from './config.mjs';
import { wrap } from './oauth-fetch.mjs';
import { STORAGE_ERROR, SecureStorageError, secureStore } from './secure-store.mjs';

/**
 * Parse the preferred OAuth callback port.
 * `off` or `0` disables the preference and lets the system choose a port.
 */
export function preferredPort(raw = process.env.RDH_OAUTH_PORT) {
  if (raw === undefined || raw === '') {
    return DEFAULT_OAUTH_PORT;
  }
  if (raw === 'off' || raw === '0') {
    return null;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `RDH_OAUTH_PORT must be "off", "0", or a port from 1 to 65535 (received ${JSON.stringify(raw)})`,
    );
  }
  return port;
}

/**
 * Test whether the loopback callback port can be used on this host.
 * The callback server listens on 127.0.0.1, so the check must use the
 * same address; binding all interfaces can succeed on systems where IPv6 and
 * IPv4 are separate sockets and would mask an IPv4 conflict.
 */
export async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (free: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      server.removeAllListeners();
      if (!server.listening) {
        resolve(free);
        return;
      }
      server.close(() => resolve(free));
    };
    server.once('error', () => finish(false));
    server.once('listening', () => finish(true));
    try {
      server.listen({ port, host: '127.0.0.1' });
    } catch {
      finish(false);
    }
  });
}

const STORAGE_DEADLINE_MS = 30_000;

async function main() {
  // Native backend and third-party errors can embed credential values. Never dump them.
  const stopSafely = (error: unknown) => {
    log(
      error instanceof SecureStorageError
        ? STORAGE_ERROR
        : 'The MCP bridge stopped unexpectedly. Restart Remote Device Hub.',
    );
    process.exit(1);
  };
  process.on('uncaughtException', stopSafely);
  process.on('unhandledRejection', stopSafely);

  let port;
  let config;
  try {
    config = resolveConfig();
    port = preferredPort();
  } catch {
    log('Invalid RDH endpoint or callback port configuration. Check the configured values.');
    process.exitCode = 1;
    return;
  }
  // A locked keyring can leave the backend call waiting on a prompt nobody
  // sees. Stop with a clear message instead of hanging the client.
  const unavailable = setTimeout(() => {
    log(STORAGE_ERROR);
    // A normal exit waits for the stuck backend call; end the process outright.
    process.kill(process.pid, 'SIGKILL');
  }, STORAGE_DEADLINE_MS);
  try {
    await secureStore.ready();
  } catch {
    log(STORAGE_ERROR);
    process.exit(1);
  } finally {
    clearTimeout(unavailable);
  }

  const fetchFn = wrap(globalThis.fetch.bind(globalThis), config);
  const auth = new BridgeAuth({ endpoint: config.endpoint, store: secureStore, port, fetchFn });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => process.exit(0));
  }
  process.exitCode = await runBridge({ endpoint: config.endpoint, auth, fetchFn });
  // Nothing else should keep the process alive once the client is gone.
  process.exit();
}

/**
 * True when this module is the process entry point.
 * Compares real paths because a profile installation is reached through a
 * symlink: `import.meta.url` and `process.argv[1]` then name the same file
 * differently, and a URL comparison would skip main() and exit silently.
 */
export function isEntryPoint(entry = process.argv[1], moduleUrl = import.meta.url) {
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  await main();
}
