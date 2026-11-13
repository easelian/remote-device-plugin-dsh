# Troubleshooting

## The bundle installs but no `mcp__remote-device-hub__*` tools appear

1. Open the **Plugins** page and confirm the bundle is enabled and has no load
   error. A `failed` row is not a successful install.
2. Ask the agent to run `list_devices` by its full tool name. If the tool does
   not exist, the MCP connection failed before tool discovery.
3. Check the Harness logs for `mcp-client(remote-device-hub)` and
   `[remote-device-hub]` lines. The launcher writes diagnostics to stderr.
4. Confirm `node_modules/dsh-remote-device-hub/bin/bridge.mjs` and
   `node_modules/@modelcontextprotocol/sdk` exist in the profile. If either is
   missing, remove and reinstall the bundle.
5. A line saying secure credential storage is unavailable means the system
   keyring is locked or missing. Unlock it and restart DSH.
6. Restart DSH if the install result said `restart-required`.

## The browser does not open for sign-in

The bridge prints the authorization URL to its stderr, which DSH captures in
its logs. Open that URL manually, complete sign-in, and wait for the callback.
The default callback is `http://127.0.0.1:3335/oauth/callback`.

If another program uses port 3335, the bridge prints a warning and uses another
port for that sign-in. Because a dynamic client registration is tied to its
callback URL, it registers a new client for that address.
To remove the preference deliberately, set `RDH_OAUTH_PORT` to `off` in the MCP
row's `env`.

On a remote or headless machine, the browser must run on the machine that can
reach the callback address. Forward `127.0.0.1:3335` from the DSH host to your
local browser if necessary. Do not paste tokens into chat.

## Sign-in repeats, or the token file disappeared

After a 401 the bridge renews the token once and sends the request again. It
starts a new browser sign-in only when the server rejects the saved refresh
token; a refresh that merely fails in transit keeps the saved sign-in. Records
live in `~/.mcp-auth/rdh-secure-v1/` and are encrypted; there is no plaintext
fallback.

Repeated login pages usually mean the flow cannot finish, not that the browser
login failed. Two common causes:

1. **OAuth discovery or token exchange times out.** Check:

   ```bash
   curl -m 10 https://rdh.easelian.com/.well-known/oauth-protected-resource/mcp
   curl -m 10 https://auth.easelian.com/.well-known/oauth-authorization-server
   ```

   For a self-hosted Hub, query its MCP resource metadata and use the listed
   authorization server for the second request. Direct
   transport is disabled by default. If the deployment provides a separate
   direct origin serving the same Hub, set `RDH_DIRECT_ORIGIN` explicitly in
   the MCP row's environment. It receives the server-side OAuth and MCP
   traffic; the browser authorization route remains public. A failed request
   is not automatically replayed on another route. Investigate uncertain
   token refresh or tool-call outcomes before retrying.

2. **A previous bridge is still holding the sign-in.** Stop DSH or disable the
   MCP row, confirm no bridge process (`bin/launcher.mjs`) is left, then enable
   it once. The callback listener should appear on `127.0.0.1:3335` while the
   browser is waiting; complete the authorization and wait for the "Signed in
   to Remote Device Hub" page before closing the tab. A sign-in times out after
   five minutes.

A sign-in that is canceled or times out leaves nothing behind; the verifier is
removed when the attempt ends. Do not delete a `_tokens.json` record while a
refresh is in progress.

## Sign-in succeeds but calls return 401

Access tokens are short-lived and refreshed in the background. If the service
revoked the grant, remove the bundle's local token cache and restart DSH; then
sign in again. Tokens live in `~/.mcp-auth/rdh-secure-v1/`; files are named by
the first 32 hex characters of the SHA-256 of the endpoint URL. Changing the endpoint changes this cache key;
use the configured URL when identifying its files.

Do not delete the whole `~/.mcp-auth` directory if other tools keep their
sign-ins there; delete only this endpoint's files, or revoke the connection in
Remote Device Hub account settings.

## Duplicate MCP bridges for the same Hub

Two bridges for the same URL share one set of records and take turns renewing
it, so they do not break each other. If their callback ports differ, a new
sign-in by one replaces the client registration the other was using. Disable or remove duplicate MCP rows and
keep this bundle as the only Remote Device Hub MCP entry in the profile.

## Approval prompts do not appear

The gate requires an approval service in the composition and
`confirmMutations: true` on the `remote-device-hub` Host row. If the profile has
no approval channel, the gate steps aside rather than denying every call. The
skill still asks the model to confirm consequential changes, but that is
guidance, not an enforced boundary. Use a profile with an approval channel when
you need the enforced prompt.

A policy of `never` blocks approval-gated calls, as it does for any other tool
that requires approval.

## The install fails while contacting GitHub

For a private Git repository, confirm that the SSH key configured for `github.com`
has access, and that `git ls-remote` works for the repository from the machine
running DSH. The plugin manager performs this check before `pnpm` starts. HTTPS
specs need a token or credential helper; an SSH spec is usually simpler.

If the diagnostic says `Host key verification failed`, the SSH key is not the
problem: this host has not trusted GitHub's host key yet. Verify the published
fingerprints against GitHub's documentation, then add the key:

```bash
ssh-keyscan -t ed25519 github.com > /tmp/github-ed25519
ssh-keygen -lf /tmp/github-ed25519
# Compare the fingerprint, then append the trusted line:
cat /tmp/github-ed25519 >> ~/.ssh/known_hosts
```

The ED25519 fingerprint must be
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`. After that,
`ssh -T git@github.com` should greet the account and the install can resolve the
repository.

## Windows

The launcher is started with the DSH executable plus
`ELECTRON_RUN_AS_NODE=1`, and the patch converts the launcher's file URL to a
Windows path. If the bundle fails to start, confirm that the profile's
`node_modules/dsh-remote-device-hub/bin/launcher.mjs` exists and that DSH was
restarted after installation. No system Node.js installation is required.

## Secure storage unavailable

Unlock the OS keyring before restarting RDH. On Linux a persistent Secret Service
is required; do not switch to a plaintext cache. A missing key for existing
ciphertext or an interrupted key initialization requires explicit recovery.
See [credential storage](credential-storage.md).
