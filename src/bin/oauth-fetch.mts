/**
 * Optional direct transport, enabled only by RDH_DIRECT_ORIGIN.
 * Browser authorization stays public. Server-side OAuth and the configured
 * MCP endpoint can use an explicitly configured origin of the same Hub.
 * Failed requests are never replayed: a timeout does not prove non-delivery.
 */

import { type BridgeConfig, resolveConfig } from './config.mjs';

const DIRECT_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/token',
  '/token/refresh',
  '/register',
  '/revoke',
]);

export function directURL(
  input: unknown,
  config: BridgeConfig = resolveConfig(),
): string | undefined {
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
  } catch {
    return undefined;
  }
  if (url === undefined || url.username || url.password) {
    return undefined;
  }
  const path = url.pathname;
  const endpoint = new URL(config.endpoint);
  const isMcp = url.origin === endpoint.origin && path === endpoint.pathname;
  const isOAuth = url.origin === config.publicOrigin && DIRECT_PATHS.has(path);
  const isResourceMetadata =
    url.origin === endpoint.origin &&
    (path === '/.well-known/oauth-protected-resource' ||
      path.startsWith('/.well-known/oauth-protected-resource/'));
  if (!isMcp && !isOAuth && !isResourceMetadata) {
    return undefined;
  }
  return `${config.directOrigin}${path}${url.search}`;
}

function replaceInput(
  input: Parameters<typeof fetch>[0],
  target: string,
): Parameters<typeof fetch>[0] {
  if (typeof input === 'string' || input instanceof URL) {
    return target;
  }
  return new Request(target, input);
}

const WRAPPED = Symbol.for('rdh.oauthFetch.wrapped');

/** Route the bridge's own requests; with no direct origin configured this is `baseFetch`. */
export function wrap(
  baseFetch: typeof fetch,
  config: BridgeConfig = resolveConfig(),
): typeof fetch {
  if (!config.directOrigin || Reflect.get(baseFetch, WRAPPED) === true) {
    return baseFetch;
  }
  const wrapped: typeof fetch = async (input, init) => {
    const target = directURL(input, config);
    return target === undefined
      ? baseFetch(input, init)
      : baseFetch(replaceInput(input, target), init);
  };
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
