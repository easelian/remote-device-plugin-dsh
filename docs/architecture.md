# Architecture

## Bundle rows

`cordis.patch.yml` inserts two rows.

| Row id | Package | Purpose |
|---|---|---|
| `mcp-remote-device-hub` | `@deepseek-ai/dsh-mcp-client` | Starts `bin/launcher.mjs` over stdio and registers the server's tools as `mcp__remote-device-hub__*`. |
| `remote-device-hub` | this package (`./index.js`) | Registers the bundled skill when `ctx.skills` exists and gates device-mutating tools through `tools/pre-execute`. |

The MCP row and the Host row share `serverName: remote-device-hub`. Changing one
without the other makes the approval gate ignore the tools, because it matches
on the public name prefix.

## Connection path

```text
DSH stdio MCP transport
  → node/Electron (ELECTRON_RUN_AS_NODE=1) bin/launcher.mjs
      MCP SDK stdio server transport ⇄ MCP SDK Streamable HTTP client transport
  → HTTPS Streamable HTTP https://rdh.easelian.com/mcp
```

DSH's MCP client supports stdio and Streamable HTTP with static headers. It has
no OAuth flow, so a static `Authorization` header cannot survive the one-hour
access-token lifetime or the rotating refresh token. The bridge is built on the
official MCP SDK (`@modelcontextprotocol/sdk`), which owns:

- protected-resource and authorization-server discovery;
- dynamic client registration, PKCE, the code exchange, and token refresh;
- both transports, so the bridge only passes messages between them.

The bridge adds what the SDK leaves to its host:

| File | Role |
|---|---|
| [`src/bin/bridge.mts`](../src/bin/bridge.mts) | Message forwarding; attaches the access token; renews once and resends after a 401; answers a failed request with an error instead of dropping the connection |
| [`src/bin/auth.mts`](../src/bin/auth.mts) | The SDK's `OAuthClientProvider` backed by encrypted storage; the loopback callback on `RDH_OAUTH_PORT` (default 3335); opening the browser |
| [`src/bin/lock.mts`](../src/bin/lock.mts) | One sign-in or refresh at a time across bridge processes, so a rotating refresh token is spent once |
| [`src/bin/secure-store.mts`](../src/bin/secure-store.mts) | AES-256-GCM records with the key in the OS keyring |

The first request triggers sign-in when nothing is saved. A refresh that fails
in transit keeps the saved sign-in and reports an error; only a refresh token
the server rejects leads to a new browser sign-in. If the preferred callback
port is busy, that sign-in uses another port and registers a new client for it.

[`bin/oauth-fetch.mjs`](../bin/oauth-fetch.mjs) wraps the bridge's `fetch`.
Direct transport is disabled by default, and the wrapper is then a no-op. An
explicit `RDH_DIRECT_ORIGIN` enables transport rewriting
for recognized OAuth routes on `RDH_PUBLIC_ORIGIN` and the exact configured MCP
endpoint path. The browser's `/authorize` route stays public. Direct failures
are propagated without replaying requests through the public route.

Generated defaults in [`src/bin/deployment-defaults.mts`](../src/bin/deployment-defaults.mts)
supply the canonical MCP origin. The launcher and the fetch wrapper share validation in
[`src/bin/config.mts`](../src/bin/config.mts). `RDH_MCP_URL` overrides the MCP
endpoint and supplies the default OAuth origin; `RDH_PUBLIC_ORIGIN` can
explicitly select a separate OAuth origin of the same Hub. Both origin
settings accept only origins, not paths or queries. URLs require HTTPS except
on loopback, and credentials and fragments are rejected.

DSH scrubs credential-shaped ambient environment variables before starting a
stdio server. The bridge does not need any secret in that environment: OAuth
state is encrypted in `~/.mcp-auth/rdh-secure-v1/`, keyed by the endpoint URL.
The encryption key stays in the OS keyring.
See [credential storage](credential-storage.md). The launcher writes only diagnostics to stderr; stdout belongs to the MCP protocol.

## Why `process.execPath`

DSH Desktop is an Electron application and does not require a system Node.js.
Its own package operations run the Electron executable with
`ELECTRON_RUN_AS_NODE=1` and `--expose-internals`. The bundle uses the same
technique for the bridge: `command: process.execPath`, with
`ELECTRON_RUN_AS_NODE=1` in `env`. A CLI-hosted DSH has a Node `process.execPath`,
where the variable is harmless.

The launcher is resolved from `ctx.baseUrl` (the profile root) and the package
name, because the MCP client needs an absolute executable path and does not
resolve row-relative paths for `args`. The expression URL-decodes the pathname
and strips the leading slash on Windows drive-letter paths.

## Approval gate

`ctx.on('tools/pre-execute', ...)` is a waterfall. The listener returns
`next()` for tools outside the `mcp__<serverName>__` namespace and when no
approval service is present. Inside the namespace, `permissionMode` decides:

| Mode | Allowed without asking |
|---|---|
| `always-ask` | nothing |
| `read-only` | the read-only set |
| `low-risk` | the read-only set plus `make_directory`, `stop_search`, and create-only `write_file` (empty `expected_sha256`) |
| `allow-all` | every tool; no listener is registered |

Every other call returns `{ kind: 'ask', reason, displayReason }`. The tool
runtime resolves `ask` through the approval service (`ctx.get('approval')`);
only `allowed-once` proceeds, and the decision is audited. The gate is
deliberately conservative: an Agent tool outside the selected
allowed set prompts rather than running silently.

`permissionMode` is a volatile field of the Host row's `Config`. The Plugins row
page renders four radio options into `plugins.row.config` under the key
`dsh-remote-device-hub#remote-device-hub`. The `confirmMutations: false` setting
maps to `allow-all` only when `permissionMode` is absent.

This gate is defense in depth, not the authority boundary. The Hub enforces the
account's authorization, the device Agent enforces roots and capability flags,
and the operating system enforces the Agent user's access. The skill instructs
the model to treat device output as untrusted and never to bypass a denied
operation through shell.

## Skill provider

The Host half uses `ctx.inject(['skills'], ...)` so a profile without the skill
registry still activates the approval gate. The provider exposes one bundled
skill with `resourceBase` pointing at `skills/remote-device-hub/`; the
references beside `SKILL.md` are readable as ordinary files. Discovery does not
read the body; every load re-reads `SKILL.md`, matching the registry contract.

The skill is registered at rank 600 (the bundled-skills rank) and has the same
name, description, and invocation policy in every profile. A user-level skill
with the same name wins by provider rank, which lets a deployment override the
guidance without editing this package.

## Failure behavior

| Failure | Observable result |
|---|---|
| Keyring locked or unavailable | Launcher stops within 30 seconds with a storage message; no tools. |
| OAuth canceled or timed out | Handshake fails; no tools until the next connection attempt. |
| Callback port busy | Warning; another port is used for this sign-in. |
| Hub unreachable for one request | That request fails with an error; the connection stays up. |
| Hub no longer knows the session | The bridge exits so the MCP client reconnects. |
| Endpoint unreachable | MCP row fails discovery; Host skill and gate still load. |
| Approval denied or unavailable | The gated call fails; calls allowed by the selected mode still work. |
| Skill registry absent | Skill is skipped; approval gate still works. |
| Approval service absent | Gate steps aside; no enforced prompt. |

The MCP client reconnects with backoff. Replacing the running package may require
a DSH restart to load a fresh module generation; configuration-only changes can
apply through HMR.

## Versioning

`package.json` declares `engines.dsh >= 0.2.0`. The plugin manager rejects an
install when the running DSH does not satisfy that requirement. Runtime dependencies are the MCP SDK, the native keyring binding, `open`, and `@deepseek-ai/schemastery`.
TypeScript sources under `src/` compile to ESM entrypoints, which
are committed for Git distribution. npm consumers receive those precompiled
files; the compiler and React/Node type declarations are development-only.
The package declares no `install`, `postinstall`, or `prepare` hook.
