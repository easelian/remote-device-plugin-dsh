/** Deployment defaults and validated runtime overrides for the stdio bridge. */
import { MCP_PUBLIC_URL } from './deployment-defaults.mjs';
export const PUBLIC_ORIGIN = validatedURL(MCP_PUBLIC_URL, 'MCP_PUBLIC_URL', true).origin;
export const DEFAULT_ENDPOINT = `${PUBLIC_ORIGIN}/mcp`;
export const DEFAULT_DIRECT_ORIGIN = '';
export const DEFAULT_OAUTH_PORT = 3335;
/** Keep custom endpoints and OAuth on the same Hub unless explicitly overridden. */
export function resolveConfig(env = process.env) {
    const endpoint = validatedURL(env.RDH_MCP_URL ?? DEFAULT_ENDPOINT, 'RDH_MCP_URL');
    const publicOrigin = validatedURL(env.RDH_PUBLIC_ORIGIN ?? endpoint.origin, 'RDH_PUBLIC_ORIGIN', true).origin;
    const rawDirect = (env.RDH_DIRECT_ORIGIN ?? DEFAULT_DIRECT_ORIGIN).trim();
    const directOrigin = rawDirect === '' || rawDirect.toLowerCase() === 'off'
        ? ''
        : validatedURL(rawDirect, 'RDH_DIRECT_ORIGIN', true).origin;
    return { endpoint: endpoint.href, publicOrigin, directOrigin };
}
function validatedURL(value, setting, originOnly = false) {
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        throw new Error(`${setting} must be an absolute HTTPS URL (HTTP is allowed on loopback).`);
    }
    const loopback = url.hostname === 'localhost' ||
        url.hostname === '[::1]' ||
        /^127(?:\.[0-9]{1,3}){3}$/u.test(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        throw new Error(`${setting} requires HTTPS; HTTP is allowed only on loopback.`);
    }
    if (url.username || url.password || url.hash || value.includes('#')) {
        throw new Error(`${setting} must not contain credentials or a fragment.`);
    }
    if (originOnly && (url.pathname !== '/' || url.search || value.includes('?'))) {
        throw new Error(`${setting} must be an origin without a path or query.`);
    }
    return url;
}
