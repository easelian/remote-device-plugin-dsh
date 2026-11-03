# Troubleshooting

## The bundle installs but no `mcp__remote-device-hub__*` tools appear

1. Open the **Plugins** page and confirm the bundle is enabled and has no load
   error. A `failed` row is not a successful install.
2. Ask the agent to run `list_devices` by its full tool name. If the tool does
   not exist, the MCP connection failed before tool discovery.
3. Check the Harness logs for `mcp-client(remote-device-hub)` and
   `[remote-device-hub]` lines. The launcher writes diagnostics to stderr.
4. Confirm `node_modules/dsh-remote-device-hub/node_modules/mcp-remote` exists
   in the profile. If it is missing, remove and reinstall the bundle.
5. Restart DSH if the install result said `restart-required`.

## The browser does not open for sign-in

The bridge prints the authorization URL to its stderr, which DSH captures in
its logs. Open that URL manually, complete sign-in, and wait for the callback.
The default callback is `http://localhost:3335/oauth/callback`.

If another program uses port 3335, the launcher prints a warning and asks
`mcp-remote` to derive a stable port for this run. Because a dynamic client
registration is tied to its callback URL, the next sign-in may be required.
To remove the preference deliberately, set `RDH_OAUTH_PORT` to `off` in the MCP
row's `env`.

On a remote or headless machine, the browser must run on the machine that can
reach the callback address. Forward `localhost:3335` from the DSH host to your
local browser if necessary. Do not paste tokens into chat.

## Sign-in repeats, or the token file disappeared

`mcp-remote` treats a 401 as invalid credentials and deletes
`~/.mcp-auth/mcp-remote-v1/<hash>_tokens.json`, then starts a new browser
authorization. There is no plaintext backup of that file; logs redact token
values, so the old access/refresh token cannot be recovered locally. Sign in
again with one clean flow.

Repeated login pages usually mean the flow cannot finish, not that the browser
login failed. Two common causes:

1. **OAuth discovery or token exchange times out.** Check:

   ```bash
   curl -m 10 https://rdh.easelian.com/.well-known/oauth-authorization-server
   ```

   For a self-hosted Hub, use its configured OAuth origin instead. Direct
   transport is disabled by default. If the deployment provides a separate
   direct origin serving the same Hub, set `RDH_DIRECT_ORIGIN` explicitly in
   the MCP row's environment. It receives the server-side OAuth and MCP
   traffic; the browser authorization route remains public. A failed request
   is not automatically replayed on another route. Investigate uncertain
   token refresh or tool-call outcomes before retrying.

2. **A previous bridge is still holding the sign-in.** Stop DSH or disable the
   MCP row, confirm no `mcp-remote` process is left, then enable it once. The
   callback listener should appear on `127.0.0.1:3335` while the browser is
   waiting; complete the authorization and wait for the "Authorization
   successful!" page before closing the tab.

A sign-in that is canceled, times out, or never reaches the callback leaves
`code_verifier` and `discovery_state` files behind. They are harmless; a later
successful sign-in deletes stale flows. Do not delete `tokens.json` while a
refresh is in progress.

## Sign-in succeeds but calls return 401

Access tokens are short-lived and refreshed in the background. If the service
revoked the grant, remove the bundle's local token cache and restart DSH; then
sign in again. Tokens live in `~/.mcp-auth/mcp-remote-v1/`; files are named by
the MD5 of the endpoint URL. Changing the endpoint changes this cache key;
use the configured URL when identifying its files.

Do not delete the whole `~/.mcp-auth` directory if other tools use
`mcp-remote`; delete only this endpoint's files, or revoke the connection in
Remote Device Hub account settings.

## Duplicate MCP bridges for the same Hub

Two bridges for the same URL share one `mcp-remote` client cache. If their
callback ports differ, each deletes the other's cached client registration on
startup, and refresh can fail. Disable or remove duplicate MCP rows and
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
