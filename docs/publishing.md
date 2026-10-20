# Publishing and distribution

This repository supports all four distribution channels below. The plugin code
and the user experience are the same; each user installs exactly one channel in
a profile.

## 1. Private GitHub repository (current)

Best for an internal team or a closed beta.

1. Keep the repository private and grant each user read access (collaborator,
   team, or organization role).
2. Each user needs:
   - DeepSeek Harness `0.2.0` or newer;
   - an SSH key authorized for GitHub, with `github.com` in
     `~/.ssh/known_hosts`;
   - permission to install a bundle in their DSH profile.
3. The user installs this exact spec from **Plugins**:

   ```text
   git+ssh://git@github.com/be-one-click/remote-device-plugin-dsh.git
   ```

   `plugin_manager` records it as `github:be-one-click/remote-device-plugin-dsh`
   in the profile and `pnpm` fetches the current commit.

### Updating a private Git install

A Git dependency is pinned in the profile lockfile. Installing the same spec
again can therefore keep the old commit. To update:

1. Install the same spec; if the manager says it is already installed, remove
   the bundle first.
2. Install it again and restart DSH if the result says `restart-required`.

For reproducible installs, publish a tag and use a ref:

```text
git+ssh://git@github.com/be-one-click/remote-device-plugin-dsh.git#v0.3.0
```

## 2. Public GitHub repository

Best when the source can be public and you do not want to run a registry.

1. Change the repository visibility to public.
2. Users install the HTTPS spec, which needs no SSH key:

   ```text
   git+https://github.com/be-one-click/remote-device-plugin-dsh.git
   ```

   Pinning a tag is recommended:
   `git+https://github.com/be-one-click/remote-device-plugin-dsh.git#v0.3.0`.

The repository still contains no secrets: the OAuth token is created per user
and stored under `~/.mcp-auth/` on the user's machine.

## 3. npm registry

Best for public or organization-wide distribution without Git access.

### Manifest status

The manifest is already prepared for publishing:

- `private` is not set;
- `repository`, `homepage`, `bugs`, and `author` are present;
- `prepublishOnly` runs `npm run check`, so a broken package cannot publish;
- `files` includes the runtime, locales, icon, docs, skill, and market index;
- `mcp-remote` remains a runtime dependency.

The package is marked `UNLICENSED`. Publishing to the public npm registry makes
the tarball publicly downloadable even though no open-source rights are granted.
Choose another license only if that is the intended distribution. For a
proprietary distribution, use a private registry instead of the public one.

The unscoped name `dsh-remote-device-hub` is currently available on npm. A
scoped name such as `@xdistribute/dsh-remote-device-hub` avoids collisions if
the organization owns that scope; add `"publishConfig": { "access": "public" }`
and `npm publish --access public` in that case.

### Publish

```bash
npm login
npm run check
npm pack --dry-run        # inspect the exact file list
npm publish               # add --access public for a scoped package
npm view dsh-remote-device-hub version
```

[`.github/workflows/publish.yml`](../.github/workflows/publish.yml) is a manual
`workflow_dispatch` workflow. It checks out the tag you enter, runs `npm ci` and
`npm run check`, then publishes. Configure an `NPM_TOKEN` repository secret and
protect the `npm` environment before using it. Add `--provenance` to the publish
command only when the repository is public; npm cannot attest a private source
repository.

Use a new version for every release (`npm version patch|minor|major`), commit
the bump, tag it, and push the tag. The workflow publishes the exact tag you
enter.

### Users install

From **Plugins**, install the package name, optionally with an exact version:

```text
dsh-remote-device-hub
dsh-remote-device-hub@0.3.0
```

The plugin manager resolves it through the user's configured registry, checks
`engines.dsh`, installs `mcp-remote`, and enables the bundle. No Git or SSH
setup is required.

For a private registry (GitHub Packages or an internal registry), each user
configures that registry in pnpm and DSH; `plugin_manager`'s `registry` option
asks the named registry first.

## 4. Plugin market index

Best for discovery in the **Discover** tab. A market index is a public HTTPS
JSON document in format 1. It is display and install metadata only; the
installed package manifest remains authoritative.

This repository includes a generated, validated index at
[`market/index.json`](../market/index.json). It lists the current npm release,
uses an inline PNG data URI for the icon, and is checked by the official
`@deepseek-ai/dsh-plugin-market-index` parser in `npm run validate`.

### Generate or update the index

```bash
npm run market
```

The generator reads `package.json`, preserves older versions already present in
the output, rejects an invalid document before writing, and keeps the icon
inside the format's 32 KiB inline limit. Run it after every version bump, before
committing and publishing.

### Host the npm index

The index is included in the npm package (`files` contains `market/*.json`), so
a CDN that serves npm packages can host it without a separate site:

```text
https://cdn.jsdelivr.net/npm/dsh-remote-device-hub@0.3.0/market/index.json
```

The version-less URL
`https://cdn.jsdelivr.net/npm/dsh-remote-device-hub/market/index.json` follows
the latest published version, at the cost of CDN caching. Pinning a version is
more reproducible. GitHub Pages or another public HTTPS host also works.

The market reader refuses redirects and credentials. A raw GitHub URL redirects,
and a private GitHub repository cannot be fetched by other users' market
readers, so use the published npm package, Pages, or a public CDN.

### Optional Git index

If the repository is public and you want the market to install a Git commit:

```bash
npm run market -- \
  --source git \
  --commit "$(git rev-parse HEAD)" \
  --out market/index.git.json
```

The generated file lists a `git` source with that commit. Host it at a public
HTTPS URL. The default Git URL is the repository root; override it with
`--git-url` for a fork or mirror. A private repository cannot be used as a
market Git source for users who lack access.

The npm index and the Git index can coexist; users add one or both as index
sources. A single plugin version has one source in an index, so do not try to
make one version point at both npm and Git.

### Users add the index

Add the final index URL in **Settings → Plugins → Discover** (or the equivalent
index-source field). `plugin_market` can only read indexes the user already
configured; it cannot add a source. Discoverability therefore needs the user to
add the index URL once.

## Release checklist

1. Update the version in `package.json`; commit.
2. Run `npm run market` so `market/index.json` lists the new version.
3. Run `npm run check`; verify `npm pack --dry-run` contains `index.js`,
   `bin/launcher.mjs`, `cordis.patch.yml`, `locale/`, `assets/`, `skills/`, and
   `market/index.json`.
4. Tag the release (`git tag -a vX.Y.Z`) and push the commit and tag.
5. Publish to npm with the manual workflow (or `npm publish`), then confirm the
   jsDelivr index URL resolves.
6. Install from a clean profile in each supported channel and call
   `mcp__remote-device-hub__list_devices`. Installation alone is not
   verification; the tool call is.
7. Confirm the first-run OAuth browser flow on a machine with no
   `~/.mcp-auth` cache for this endpoint.

## What users need

Regardless of channel, every user needs:

- DeepSeek Harness `0.2.0` or newer;
- a Remote Device Hub account with at least one authorized, online device;
- a browser for the first OAuth sign-in;
- permission to install a bundle in their DSH profile.

The plugin contains no account credentials. The access and refresh tokens are
created by the OAuth flow and stored by `mcp-remote` under
`~/.mcp-auth/mcp-remote-v1/`. A device's `allow_write` and `allow_shell`
settings still apply, and the bundle's approval gate asks before mutation when
the profile has an approval channel.
