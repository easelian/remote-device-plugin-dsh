/**
 * Sign-in for the stdio bridge, built on the MCP SDK's OAuth client.
 *
 * The SDK owns the protocol: discovery, client registration, PKCE, the code
 * exchange, and refresh. This module supplies what the SDK leaves to its host:
 * encrypted storage, the loopback callback, opening the browser, and making
 * sure several bridge processes never spend the same rotating refresh token.
 */
import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { authorizationNotice, log } from './bridge-log.mjs';
import { withLock } from './lock.mjs';
import type { SecureStore } from './secure-store.mjs';

export const CALLBACK_PATH = '/oauth/callback';
export const CLIENT_NAME = 'Remote Device Hub for DeepSeek Harness';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const RENEW_BEFORE_MS = 60_000;

/** A request could not be authorized right now; signing in again is not the remedy. */
export class AuthUnavailableError extends Error {}
/** The user did not complete the browser sign-in. */
export class SignInError extends Error {}

class NeedsSignIn extends Error {}

interface TokenRecord {
  tokens: OAuthTokens;
  obtained_at: number;
}

type DiscoveryState = Awaited<ReturnType<NonNullable<OAuthClientProvider['discoveryState']>>>;

export interface AuthOptions {
  endpoint: string;
  store: SecureStore;
  /** Preferred loopback callback port; `null` lets the system choose. */
  port?: number | null;
  fetchFn?: typeof fetch;
  openBrowser?: (url: string) => Promise<unknown>;
  signInTimeoutMs?: number;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parse(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class BridgeAuth {
  private readonly server: string;
  private readonly store: SecureStore;
  private readonly fetchFn: typeof fetch;
  private readonly openBrowser: (url: string) => Promise<unknown>;
  private readonly now: () => number;
  private readonly preferredPort: number | null;
  private readonly signInTimeoutMs: number;
  private redirectUrl: string;
  private interactive = false;
  private expectedState = '';
  private authorizationUrl: URL | undefined;
  private discovery: DiscoveryState;
  private inflight: Promise<string> | undefined;

  constructor(private readonly options: AuthOptions) {
    this.store = options.store;
    this.server = createHash('sha256').update(options.endpoint).digest('hex').slice(0, 32);
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.preferredPort = options.port === undefined ? null : options.port;
    this.signInTimeoutMs = options.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS;
    this.openBrowser = options.openBrowser ?? (async (url) => (await import('open')).default(url));
    this.redirectUrl = `http://127.0.0.1:${this.preferredPort ?? 0}${CALLBACK_PATH}`;
  }

  private async record(): Promise<TokenRecord | undefined> {
    const value = parse(await this.store.read(this.server, 'tokens.json'));
    if (
      isRecord(value) &&
      isRecord(value.tokens) &&
      typeof value.tokens.access_token === 'string' &&
      typeof value.obtained_at === 'number'
    ) {
      return value as unknown as TokenRecord;
    }
    return undefined;
  }

  private usable(record: TokenRecord | undefined, rejected: string | undefined): boolean {
    if (!record || record.tokens.access_token === rejected) {
      return false;
    }
    const lifetime = record.tokens.expires_in;
    return (
      typeof lifetime !== 'number' ||
      record.obtained_at + lifetime * 1000 - RENEW_BEFORE_MS > this.now()
    );
  }

  /**
   * A current access token. `rejected` is a token the server just refused, so
   * the stored copy is used only if another process has already replaced it.
   */
  accessToken(rejected?: string): Promise<string> {
    // One renewal at a time in this process; the lock covers other processes.
    const run = (this.inflight ?? Promise.resolve(''))
      .catch(() => '')
      .then(() => this.resolve(rejected));
    this.inflight = run;
    return run;
  }

  private async resolve(rejected: string | undefined): Promise<string> {
    await this.store.ready();
    let record = await this.record();
    if (this.usable(record, rejected)) {
      return record!.tokens.access_token;
    }
    const seen = record?.tokens.access_token;
    await withLock(this.store.directory, '.auth-lock', async () => {
      // Another bridge may have renewed or signed in while this one waited.
      // Whatever it stored is newer than what this process saw, so use it
      // rather than spending the rotating refresh token a second time.
      const current = await this.record();
      const replaced =
        current !== undefined &&
        current.tokens.access_token !== seen &&
        current.tokens.access_token !== rejected;
      if (!replaced && !this.usable(current, rejected)) {
        await this.renew();
      }
    });
    record = await this.record();
    if (!record) {
      throw new SignInError('Sign-in did not complete.');
    }
    return record.tokens.access_token;
  }

  private provider(): OAuthClientProvider {
    const self = this;
    return {
      get redirectUrl() {
        return self.redirectUrl;
      },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: CLIENT_NAME,
          redirect_uris: [self.redirectUrl],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
      },
      state: () => {
        self.expectedState = randomBytes(24).toString('base64url');
        return self.expectedState;
      },
      clientInformation: async () => {
        const value = parse(await self.store.read(self.server, 'client.json'));
        return isRecord(value) && typeof value.client_id === 'string'
          ? (value as OAuthClientInformationMixed)
          : undefined;
      },
      saveClientInformation: (value) =>
        self.store.write(self.server, 'client.json', JSON.stringify(value)),
      tokens: async () => (await self.record())?.tokens,
      // Stored exactly as received: the SDK binds tokens to their issuer.
      saveTokens: (tokens) =>
        self.store.write(
          self.server,
          'tokens.json',
          JSON.stringify({ tokens, obtained_at: self.now() } satisfies TokenRecord),
        ),
      saveCodeVerifier: (value) => self.store.write(self.server, 'verifier.txt', value),
      codeVerifier: async () => {
        const value = await self.store.read(self.server, 'verifier.txt');
        if (value === undefined) {
          throw new SignInError('Sign-in state is missing; start again.');
        }
        return value;
      },
      redirectToAuthorization: (url) => {
        if (!self.interactive) {
          throw new NeedsSignIn();
        }
        self.authorizationUrl = url;
      },
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'tokens') {
          await self.store.remove(self.server, 'tokens.json');
        }
        if (scope === 'all' || scope === 'client') {
          await self.store.remove(self.server, 'client.json');
        }
        if (scope === 'all' || scope === 'verifier') {
          await self.store.remove(self.server, 'verifier.txt');
        }
        if (scope === 'all' || scope === 'discovery') {
          self.discovery = undefined;
        }
      },
      saveDiscoveryState: (state) => {
        self.discovery = state;
      },
      discoveryState: () => self.discovery,
    };
  }

  /** Refresh if a refresh token still works; otherwise sign in through the browser. */
  private async renew(): Promise<void> {
    const provider = this.provider();
    const before = await this.record();
    if (before?.tokens.refresh_token && (await provider.clientInformation())) {
      this.interactive = false;
      try {
        await auth(provider, { serverUrl: this.options.endpoint, fetchFn: this.fetchFn });
        log('Refreshed the access token.');
        return;
      } catch (error) {
        if (!(error instanceof NeedsSignIn)) {
          throw new AuthUnavailableError('The sign-in service could not be reached.');
        }
        // The SDK also falls through to a new sign-in when the refresh request
        // merely failed in transit. Credentials that are still stored were not
        // rejected, so keep them and report the outage instead.
        const after = await this.record();
        if (after?.tokens.refresh_token === before.tokens.refresh_token) {
          throw new AuthUnavailableError('The sign-in service could not be reached.');
        }
      }
    }
    await this.signIn(provider);
  }

  private async signIn(provider: OAuthClientProvider): Promise<void> {
    const callback = await this.listen();
    try {
      this.redirectUrl = `http://127.0.0.1:${callback.port}${CALLBACK_PATH}`;
      // A registration made for another callback address cannot be reused.
      const client = await provider.clientInformation();
      const registered = client && 'redirect_uris' in client ? client.redirect_uris : undefined;
      if (client && !(Array.isArray(registered) && registered.includes(this.redirectUrl))) {
        await provider.invalidateCredentials?.('client');
        await provider.invalidateCredentials?.('tokens');
      }
      this.interactive = true;
      this.authorizationUrl = undefined;
      const options = { serverUrl: this.options.endpoint, fetchFn: this.fetchFn };
      if ((await auth(provider, options)) === 'AUTHORIZED') {
        return;
      }
      const url = this.authorizationUrl as URL | undefined;
      if (!url) {
        throw new SignInError('Sign-in could not start.');
      }
      log(authorizationNotice(url, new URL(this.options.endpoint).protocol === 'http:'));
      try {
        await this.openBrowser(url.href);
      } catch {
        log('Could not open a browser automatically. Open the link above to continue.');
      }
      const code = await callback.code;
      await auth(provider, { ...options, authorizationCode: code });
      log('Signed in to Remote Device Hub.');
    } finally {
      this.interactive = false;
      callback.close();
      await provider.invalidateCredentials?.('verifier');
    }
  }

  private async listen(): Promise<{ port: number; code: Promise<string>; close: () => void }> {
    let settle: (code: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const code = new Promise<string>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // Awaited later; a timeout before then must not count as unhandled.
    code.catch(() => {});
    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const page = (status: number, text: string) => {
        response.writeHead(status, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'close',
        });
        response.end(text);
      };
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        page(404, 'Not found.');
        return;
      }
      const state = url.searchParams.get('state');
      const value = url.searchParams.get('code');
      if (!this.expectedState || state !== this.expectedState) {
        // Not our request: ignore it and keep waiting for the real one.
        page(400, 'This sign-in link is not valid for the current request.');
        return;
      }
      if (url.searchParams.has('error') || !value) {
        page(400, 'Sign-in was not completed. You can close this window and try again.');
        fail(new SignInError('Sign-in was declined or failed.'));
        return;
      }
      page(200, 'Signed in to Remote Device Hub. You can close this window.');
      settle(value);
    });
    const bind = (port: number) =>
      new Promise<boolean>((resolve) => {
        server.once('error', () => resolve(false));
        // Loopback only, matching the registered callback address.
        server.listen(port, '127.0.0.1', () => resolve(true));
      });
    if (this.preferredPort === null || !(await bind(this.preferredPort))) {
      if (this.preferredPort !== null) {
        log(
          `OAuth callback port ${this.preferredPort} is busy; using another port for this sign-in.`,
        );
      }
      server.removeAllListeners('error');
      if (!(await bind(0))) {
        throw new SignInError('Could not listen on 127.0.0.1 for the sign-in callback.');
      }
    }
    const timer = setTimeout(
      () => fail(new SignInError('Sign-in timed out.')),
      this.signInTimeoutMs,
    );
    timer.unref();
    return {
      port: (server.address() as AddressInfo).port,
      code,
      close: () => {
        clearTimeout(timer);
        server.closeAllConnections();
        server.close();
      },
    };
  }
}
