#!/usr/bin/env node
/**
 * Remote Device Hub stdio bridge.
 *
 * DSH speaks MCP over stdio, while Remote Device Hub exposes a protected
 * Streamable HTTP endpoint that requires OAuth. This launcher runs the
 * `mcp-remote` proxy with the endpoint and a stable local OAuth callback port,
 * so the DSH MCP client can treat the service like a local stdio server.
 */

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

import { DEFAULT_ENDPOINT, DEFAULT_OAUTH_PORT } from './config.mjs'

const require = createRequire(import.meta.url)

/** Resolve the installed mcp-remote proxy entry. */
export function resolveProxy() {
  return require.resolve('mcp-remote/dist/proxy.js')
}

/**
 * Parse the preferred OAuth callback port.
 * `off` or `0` disables the preference and lets mcp-remote derive its own port.
 */
export function preferredPort(raw = process.env.RDH_OAUTH_PORT) {
  if (raw === undefined || raw === '') return DEFAULT_OAUTH_PORT
  if (raw === 'off' || raw === '0') return null
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`RDH_OAUTH_PORT must be "off", "0", or a port from 1 to 65535 (received ${JSON.stringify(raw)})`)
  }
  return port
}

/** Build the argv passed to mcp-remote. */
export function buildProxyArgs({ proxyPath, url, port, transport = 'http-only' }: {
  proxyPath: string
  url: string
  port?: number | null
  transport?: string
}): string[] {
  const args = [proxyPath, url]
  if (port !== null && port !== undefined) args.push(String(port))
  args.push('--transport', transport)
  return args
}

/**
 * Test whether the loopback port mcp-remote binds can be used on this host.
 * mcp-remote's callback server listens on 127.0.0.1, so the check must use the
 * same address; binding all interfaces can succeed on systems where IPv6 and
 * IPv4 are separate sockets and would mask an IPv4 conflict.
 */
export async function isPortFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    let settled = false
    const finish = (free: boolean) => {
      if (settled) return
      settled = true
      server.removeAllListeners()
      if (!server.listening) {
        resolve(free)
        return
      }
      server.close(() => resolve(free))
    }
    server.once('error', () => finish(false))
    server.once('listening', () => finish(true))
    try {
      server.listen({ port, host: '127.0.0.1' })
    } catch {
      finish(false)
    }
  })
}

function log(message: string): void {
  process.stderr.write(`[remote-device-hub] ${message}\n`)
}

async function main() {
  let proxyPath
  try {
    proxyPath = resolveProxy()
  } catch {
    log('mcp-remote is missing. Reinstall the dsh-remote-device-hub bundle.')
    process.exitCode = 1
    return
  }

  let port
  try {
    port = preferredPort()
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }

  if (port !== null && !(await isPortFree(port))) {
    log(`OAuth callback port ${port} is busy; letting mcp-remote choose its derived port for this run.`)
    port = null
  }

  const url = process.env.RDH_MCP_URL?.trim() || DEFAULT_ENDPOINT
  const preloadPath = fileURLToPath(new URL('./oauth-fetch.mjs', import.meta.url))
  const args = ['--import', preloadPath, ...buildProxyArgs({ proxyPath, url, port })]
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal)
  }
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) {
    process.on(signal, () => forward(signal))
  }

  child.once('error', (error) => {
    log(`could not start mcp-remote: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      process.exitCode = 1
      return
    }
    process.exitCode = code ?? 1
  })
}

/**
 * True when this module is the process entry point.
 * Compares real paths because a profile installation is reached through a
 * symlink: `import.meta.url` and `process.argv[1]` then name the same file
 * differently, and a URL comparison would skip main() and exit silently.
 */
export function isEntryPoint(entry = process.argv[1], moduleUrl = import.meta.url) {
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  await main()
}
