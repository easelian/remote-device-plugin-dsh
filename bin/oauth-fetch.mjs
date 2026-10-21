/**
 * Preload for the stdio OAuth bridge.
 *
 * The public Cloudflare route serves the browser authorization page, but its
 * /.well-known/*, /token, and /mcp routes can time out. The Hub's direct origin
 * (`DIRECT_HOST:DIRECT_PORT` in `config.mjs`, overridable with
 * RDH_DIRECT_ORIGIN) serves the same OAuth contract and MCP endpoint. Rewrite
 * the server-side OAuth calls and /mcp to that origin; only the browser
 * authorization URL stays on the public origin.
 *
 * mcp-remote calls both global `fetch` and the `fetch` exported by `undici`, so
 * both entry points are wrapped. This module is loaded with `node --import`
 * before mcp-remote. It never logs request headers or bodies.
 */
import { createRequire } from 'node:module';
import { DEFAULT_DIRECT_ORIGIN, PUBLIC_ORIGIN as DEFAULT_PUBLIC_ORIGIN } from './config.mjs';
const PUBLIC_ORIGIN = (process.env.RDH_PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN).replace(/\/$/u, '');
const DIRECT_ORIGIN = (process.env.RDH_DIRECT_ORIGIN ?? DEFAULT_DIRECT_ORIGIN).replace(/\/$/u, '');
const ENABLED = DIRECT_ORIGIN !== '' && DIRECT_ORIGIN.toLowerCase() !== 'off';
const DIRECT_PATHS = new Set([
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/token',
    '/token/refresh',
    '/register',
    '/revoke',
    '/mcp',
]);
export function directURL(input) {
    if (!ENABLED) {
        return undefined;
    }
    let url;
    try {
        url =
            typeof input === 'string'
                ? new URL(input)
                : input instanceof URL
                    ? input
                    : isRecord(input) && typeof input.url === 'string'
                        ? new URL(input.url)
                        : undefined;
    }
    catch {
        return undefined;
    }
    if (url === undefined || url.origin !== PUBLIC_ORIGIN) {
        return undefined;
    }
    const path = url.pathname;
    if (!path.startsWith('/.well-known/oauth-protected-resource') && !DIRECT_PATHS.has(path)) {
        return undefined;
    }
    return `${DIRECT_ORIGIN}${path}${url.search}`;
}
function replaceInput(input, target) {
    if (typeof input === 'string' || input instanceof URL) {
        return target;
    }
    return new Request(target, input);
}
const WRAPPED = Symbol.for('rdh.oauthFetch.wrapped');
export function wrap(baseFetch) {
    const marker = Reflect.get(baseFetch, WRAPPED);
    if (marker === true) {
        return baseFetch;
    }
    const wrapped = async (input, init) => {
        const target = directURL(input);
        if (target === undefined) {
            return baseFetch(input, init);
        }
        try {
            return await baseFetch(replaceInput(input, target), init);
        }
        catch (directError) {
            // A self-hosted or healthy public route still works if the direct origin
            // is unavailable. Keep the original failure if both attempts fail.
            try {
                return await baseFetch(input, init);
            }
            catch {
                throw directError;
            }
        }
    };
    Object.defineProperty(wrapped, WRAPPED, { value: true });
    return wrapped;
}
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
function isFetchModule(value) {
    return isRecord(value) && typeof value.fetch === 'function';
}
function patchUndici(requireFrom) {
    try {
        const undici = requireFrom('undici');
        if (isFetchModule(undici)) {
            undici.fetch = wrap(undici.fetch.bind(undici));
        }
    }
    catch {
        // A deployment without this copy of undici still uses the global wrapper.
    }
}
if (ENABLED) {
    globalThis.fetch = wrap(globalThis.fetch.bind(globalThis));
    // mcp-remote imports `fetch as fetch2` from undici for token exchange and
    // transport requests. The plugin's dependency tree can hold more than one
    // undici copy, so patch the copy resolved from the proxy itself as well as
    // the one next to this preload.
    const proxyArg = process.argv.find((arg) => /(?:^|[\\/])mcp-remote[\\/]dist[\\/]proxy\.js$/u.test(arg));
    if (proxyArg !== undefined) {
        patchUndici(createRequire(proxyArg));
    }
    patchUndici(createRequire(import.meta.url));
}
