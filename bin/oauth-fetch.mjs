/**
 * Preload for the stdio OAuth bridge.
 *
 * The public Cloudflare route serves /mcp and /authorize, but its
 * /.well-known/* and /token routes are currently unreliable. The Hub's direct
 * origin on port 8090 serves the same OAuth contract. Rewrite only the
 * server-side OAuth calls to that origin; the browser authorization URL and the
 * MCP endpoint stay on the public origin.
 *
 * This module is loaded with `node --import` before mcp-remote. It never logs
 * request headers or bodies.
 */

const PUBLIC_ORIGIN = (process.env.RDH_PUBLIC_ORIGIN ?? 'https://mcp.xdistribute.site').replace(/\/$/u, '')
const DIRECT_ORIGIN = (process.env.RDH_DIRECT_ORIGIN ?? 'https://xdistribute.site:8090').replace(/\/$/u, '')
const ENABLED = DIRECT_ORIGIN !== '' && DIRECT_ORIGIN.toLowerCase() !== 'off'

const DIRECT_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/token',
  '/token/refresh',
  '/register',
  '/revoke',
])

function directURL(input) {
  if (!ENABLED) return undefined
  let url
  try {
    url = typeof input === 'string'
      ? new URL(input)
      : input instanceof URL
        ? input
        : new URL(input.url)
  } catch {
    return undefined
  }
  if (url.origin !== PUBLIC_ORIGIN) return undefined
  const path = url.pathname
  if (!path.startsWith('/.well-known/oauth-protected-resource') && !DIRECT_PATHS.has(path)) return undefined
  return `${DIRECT_ORIGIN}${path}${url.search}`
}

function replaceInput(input, target) {
  if (typeof input === 'string' || input instanceof URL) return target
  return new Request(target, input)
}

const baseFetch = globalThis.fetch.bind(globalThis)

if (ENABLED) {
  globalThis.fetch = async (input, init) => {
    const target = directURL(input)
    if (target === undefined) return baseFetch(input, init)
    try {
      return await baseFetch(replaceInput(input, target), init)
    } catch (directError) {
      // A self-hosted or healthy public route still works if the direct origin
      // is unavailable. Keep the original failure if both attempts fail.
      try {
        return await baseFetch(input, init)
      } catch {
        throw directError
      }
    }
  }
}
