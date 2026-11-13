/** Only known events reach stderr. Upstream error objects and debug payloads never do. */
import { STORAGE_ERROR, SecureStorageError } from './secure-store.mjs';

const EVENTS = new Set([
  'Discovering OAuth server configuration...',
  'Browser opened automatically.',
  'Could not open a browser automatically. Please copy and paste the URL above into your browser.',
  'Local STDIO server running',
  'Re-authorized with the remote server',
  'Refreshed the access token before it expired',
  'A sign-in for this server is already under way; not starting another',
  'The sign-in was completed by another instance; using the tokens it wrote',
  'Proactive token refresh failed, falling back to the stored token',
  'Shutting down...',
]);

export function bridgeMessage(message: unknown, args: unknown[] = []): string | undefined {
  if (args.some((arg) => arg instanceof SecureStorageError)) {
    return STORAGE_ERROR;
  }
  if (typeof message !== 'string') {
    return 'MCP bridge error. Check connectivity and sign in again if authorization was revoked.';
  }
  if (EVENTS.has(message.trim())) {
    return message.trim();
  }
  // This intentionally public login link is needed when a browser cannot open.
  // Never print callbacks, token endpoints, fragments, or arbitrary OAuth fields.
  const match = /^\nPlease authorize this client by visiting:\n([^\n]+)\n$/u.exec(message);
  if (match?.[1]) {
    try {
      const url = new URL(match[1]);
      const fields = new Set([
        'response_type',
        'client_id',
        'redirect_uri',
        'code_challenge',
        'code_challenge_method',
        'scope',
        'state',
        'resource',
      ]);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.searchParams.get('response_type') === 'code' &&
        [...url.searchParams.keys()].every((key) => fields.has(key))
      ) {
        return `Authorize Remote Device Hub in your browser:\n${url.href}`;
      }
    } catch {
      // Untrusted URLs are never included in diagnostics.
    }
    return 'Open the authorization page in the browser launched by Remote Device Hub.';
  }
  if (/error|failed|fatal|refused|reject/iu.test(message)) {
    return 'MCP bridge error. Check connectivity and sign in again if authorization was revoked.';
  }
  return undefined;
}

export function bridgeLog(message: unknown, ...args: unknown[]): void {
  const safe = bridgeMessage(message, args);
  if (safe) {
    process.stderr.write(`[remote-device-hub] ${safe}\n`);
  }
}
