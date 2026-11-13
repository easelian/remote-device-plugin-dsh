/** Diagnostics on stderr. Only messages written here are printed; error objects never are. */

export function log(message: string): void {
  process.stderr.write(`[remote-device-hub] ${message}\n`);
}

const AUTHORIZE_FIELDS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'state',
  'resource',
]);

/**
 * The sign-in link is public by design and is needed when no browser opens.
 * Anything that does not look like a plain authorization request is withheld.
 */
export function authorizationNotice(url: URL, allowHttp = false): string {
  const plain =
    (url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')) &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.searchParams.get('response_type') === 'code' &&
    [...url.searchParams.keys()].every((key) => AUTHORIZE_FIELDS.has(key));
  return plain
    ? `Authorize Remote Device Hub in your browser:\n${url.href}`
    : 'Open the authorization page in the browser launched by Remote Device Hub.';
}
