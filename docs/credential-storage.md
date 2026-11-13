# Credential storage

The private bridge stores OAuth tokens, client registration, PKCE verifiers, and
flow metadata as AES-256-GCM ciphertext in `~/.mcp-auth/rdh-secure-v1/` (or the
`rdh-secure-v1` child of `MCP_REMOTE_CONFIG_DIR`). A random 256-bit key is stored
in the OS keyring, scoped to the canonical cache directory. On Linux the binding
requires persistent Secret Service; it does not fall back to kernel-only storage.
The directory uses mode 0700 and records use 0600 on Unix. Windows protection
also depends on the user's profile ACLs. Refresh leases contain only coordination
metadata. Encryption does not protect tokens from a compromised bridge process.

Storage is selected once for the process. A locked or unavailable keyring, invalid
ciphertext, or a missing key over existing records stops credential access. There
is no plaintext read or write fallback. Writes use private temporary ciphertext
files and atomic replacement. Refresh and sibling-process coordination remain
owned by the pinned bridge.

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

## Maintainer contract

`src/scripts/build-bridge.mts` verifies exact hashes of the pinned mcp-remote
0.15.1 source before generating `bin/bridge/`. It replaces the complete credential
read/write boundary and logging functions, without modifying shared node_modules
or intercepting global filesystem APIs. Generated bridge files are committed for
Git installs and included in npm packages. Upgrades require reviewing the boundary,
updating hashes, rebuilding, and running the security and native keyring tests.
The upstream license is shipped alongside the generated bridge. This private
entry accepts only RDH launcher options and browser OAuth; upstream device-code
and static-token CLI modes are not exposed.

Upstream debug payloads are disabled, including token objects and protocol bodies.
Only approved lifecycle events and a validated browser authorization link reach
stderr. Backend and transport exceptions are not dumped to logs.

Run `npm run check` and `npm run style:check`. On Linux with `dbus-run-session`
and `gnome-keyring-daemon`, run `npm run test:keyring` for an isolated native
Secret Service test with disposable credentials. It does not use a real account.
