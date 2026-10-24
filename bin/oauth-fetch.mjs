/**
 * Optional direct transport, enabled only by RDH_DIRECT_ORIGIN.
 * Browser authorization stays public. Server-side OAuth and the configured
 * MCP endpoint can use an explicitly configured origin of the same Hub.
 * Failed requests are never replayed: a timeout does not prove non-delivery.
 */
import { createRequire } from 'node:module';
import { resolveConfig } from './config.mjs';
const CONFIG = resolveConfig();
const DIRECT_PATHS = new Set([
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/token',
    '/token/refresh',
    '/register',
    '/revoke',
]);
export function directURL(input, config = CONFIG) {
    if (!config.directOrigin) {
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
    if (url === undefined || url.username || url.password) {
        return undefined;
    }
    const path = url.pathname;
    const endpoint = new URL(config.endpoint);
    const isMcp = url.origin === endpoint.origin && path === endpoint.pathname;
    const isOAuth = url.origin === config.publicOrigin && DIRECT_PATHS.has(path);
    const isResourceMetadata = url.origin === endpoint.origin &&
        (path === '/.well-known/oauth-protected-resource' ||
            path.startsWith('/.well-known/oauth-protected-resource/'));
    if (!isMcp && !isOAuth && !isResourceMetadata) {
        return undefined;
    }
    return `${config.directOrigin}${path}${url.search}`;
}
function replaceInput(input, target) {
    if (typeof input === 'string' || input instanceof URL) {
        return target;
    }
    return new Request(target, input);
}
const WRAPPED = Symbol.for('rdh.oauthFetch.wrapped');
export function wrap(baseFetch, config = CONFIG) {
    const marker = Reflect.get(baseFetch, WRAPPED);
    if (marker === true) {
        return baseFetch;
    }
    const wrapped = async (input, init) => {
        const target = directURL(input, config);
        if (target === undefined) {
            return baseFetch(input, init);
        }
        return baseFetch(replaceInput(input, target), init);
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
if (CONFIG.directOrigin) {
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
