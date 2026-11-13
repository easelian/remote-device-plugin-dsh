# Credential storage

The bridge stores OAuth tokens, the client registration, and the PKCE verifier
as AES-256-GCM ciphertext in `~/.mcp-auth/rdh-secure-v1/` (or the
`rdh-secure-v1` child of `MCP_REMOTE_CONFIG_DIR`). A random 256-bit key is stored
in the OS keyring, scoped to the canonical cache directory. On Linux the binding
requires persistent Secret Service; it does not fall back to kernel-only storage.
The directory uses mode 0700 and records use 0600 on Unix. Windows protection
also depends on the user's profile ACLs. Encryption does not protect tokens from
a compromised bridge process.

Storage is selected once for the process. A locked or unavailable keyring, invalid
ciphertext, or a missing key over existing records stops credential access. There
is no plaintext read or write fallback. Writes use private temporary ciphertext
files and atomic replacement. Records are named `<key>_tokens.json` and
`<key>_client.json`, where `<key>` is the first 32 hex characters of the
SHA-256 of the endpoint URL.

Bridge processes sharing the directory take turns through `.auth-lock`, a lock
directory that holds only the owner's process id. A lock whose owner has exited,
or that is older than ten minutes, is taken over automatically.

## Upgrade and removal

This version does not read or import the old `mcp-remote-v1` plaintext cache.
Stop older bridges and sign in again. Revoke the old connection in RDH account
settings, then remove only its old endpoint cache if it is no longer used by
another client. Upgrading does not itself delete or revoke older credentials.
Disabling or uninstalling the bundle does not revoke the server grant. Revoke it
in RDH account settings; stop the bridge before deleting its encrypted records.
Do not remove the directory's encryption key while other endpoint records remain.

A stale `.key-init-lock` is not stolen automatically. After confirming all RDH
bridges using this cache have stopped, remove that empty lock directory and retry.
If the encryption key was lost, revoke the affected authorizations, remove the
unreadable encrypted records, and sign in again. Do not restore plaintext files
into the secure directory.

Records written by the earlier patched bridge in the same directory are not
read. They are encrypted and can be deleted once that version is no longer used.

## Maintainer contract

The bridge uses only public interfaces of the MCP SDK: its two transports and
its OAuth client with a storage provider. Nothing in `node_modules` is patched or
copied, so an SDK upgrade is an ordinary dependency update followed by the tests
below. Keep these properties when changing the bridge:

- every credential read and write goes through `secure-store.mts`;
- stored tokens and client information are saved exactly as the SDK hands them
  over, because it binds them to their issuer;
- renewal and sign-in run under `.auth-lock`;
- stderr carries only messages written in this package and a validated browser
  authorization link; error objects, response bodies, and tokens are never
  printed, and replies to the MCP client carry only this package's own text;
- stdout carries only MCP messages.

Run `npm run check` and `npm run style:check`. On Linux with `dbus-run-session`
and `gnome-keyring-daemon`, run `npm run test:keyring` for an isolated native
Secret Service test with disposable credentials. It does not use a real account.
