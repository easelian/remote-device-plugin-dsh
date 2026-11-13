#!/usr/bin/env node
/**
 * Remote Device Hub stdio bridge.
 *
 * DSH speaks MCP over stdio, while Remote Device Hub exposes a protected
 * Streamable HTTP endpoint that requires OAuth. This launcher runs the
 * `mcp-remote` proxy with the endpoint and a stable local OAuth callback port,
 * so the DSH MCP client can treat the service like a local stdio server.
 */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OAUTH_PORT, resolveConfig } from './config.mjs';
/** Resolve only the generated secure bridge; never fall back to the upstream executable. */
export function resolveProxy() {
    return realpathSync(fileURLToPath(new URL('./bridge/proxy.js', import.meta.url)));
}
/**
 * Parse the preferred OAuth callback port.
 * `off` or `0` disables the preference and lets mcp-remote derive its own port.
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
        throw new Error(`RDH_OAUTH_PORT must be "off", "0", or a port from 1 to 65535 (received ${JSON.stringify(raw)})`);
    }
    return port;
}
/** Build the argv passed to mcp-remote. */
export function buildProxyArgs({ proxyPath, url, port, transport = 'http-only', }) {
    const endpoint = resolveConfig({ RDH_MCP_URL: url }).endpoint;
    const args = [proxyPath, endpoint];
    if (port !== null && port !== undefined) {
        args.push(String(port));
    }
    args.push('--transport', transport, '--static-oauth-client-metadata', JSON.stringify({ client_name: 'Remote Device Hub for DeepSeek Harness' }));
    if (new URL(endpoint).protocol === 'http:') {
        args.push('--allow-http');
    }
    return args;
}
/**
 * Test whether the loopback port mcp-remote binds can be used on this host.
 * mcp-remote's callback server listens on 127.0.0.1, so the check must use the
 * same address; binding all interfaces can succeed on systems where IPv6 and
 * IPv4 are separate sockets and would mask an IPv4 conflict.
 */
export async function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        let settled = false;
        const finish = (free) => {
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
        }
        catch {
            finish(false);
        }
    });
}
function log(message) {
    process.stderr.write(`[remote-device-hub] ${message}\n`);
}
async function main() {
    let proxyPath;
    try {
        proxyPath = resolveProxy();
    }
    catch {
        log('The secure MCP bridge is missing. Reinstall the dsh-remote-device-hub bundle.');
        process.exitCode = 1;
        return;
    }
    let port;
    let config;
    try {
        config = resolveConfig();
        port = preferredPort();
    }
    catch {
        log('Invalid RDH endpoint or callback port configuration. Check the configured values.');
        process.exitCode = 1;
        return;
    }
    if (port !== null && !(await isPortFree(port))) {
        log(`OAuth callback port ${port} is busy; letting mcp-remote choose its derived port for this run.`);
        port = null;
    }
    const url = config.endpoint;
    const preloadPath = fileURLToPath(new URL('./oauth-fetch.mjs', import.meta.url));
    const args = ['--import', preloadPath, ...buildProxyArgs({ proxyPath, url, port })];
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    const forward = (signal) => {
        if (!child.killed) {
            child.kill(signal);
        }
    };
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    for (const signal of signals) {
        process.on(signal, () => forward(signal));
    }
    child.once('error', () => {
        log('Could not start the secure MCP bridge. Check the installation.');
        process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
        if (signal) {
            process.exitCode = 1;
            return;
        }
        process.exitCode = code ?? 1;
    });
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
    }
    catch {
        return false;
    }
}
if (isEntryPoint()) {
    await main();
}
