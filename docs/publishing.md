# Publishing and distribution

This repository can be distributed in four ways. Choose one primary channel;
the plugin code and the user experience are the same.

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
   git+ssh://git@github.com/just-one-click/remote-device-plugin-dsh.git
   ```

   `plugin_manager` records it as `github:just-one-click/remote-device-plugin-dsh`
   in the profile and `pnpm` fetches the current commit.

### Updating a private Git install

A Git dependency is pinned in the profile lockfile. Installing the same spec
again can therefore keep the old commit. To update:

1. Install the same spec; if the manager says it is already installed, remove
   the bundle first.
2. Install it again and restart DSH if the result says `restart-required`.

For reproducible installs, publish a tag and use a ref:

```text
git+ssh://git@github.com/just-one-click/remote-device-plugin-dsh.git#v0.1.0
```

## 2. Public GitHub repository

Best when the source can be public and you do not want to run a registry.

1. Change the repository visibility to public.
2. Users install the HTTPS spec, which needs no SSH key:

   ```text
   git+https://github.com/just-one-click/remote-device-plugin-dsh.git
   ```

   Pinning a tag is recommended:
   `git+https://github.com/just-one-click/remote-device-plugin-dsh.git#v0.1.0`.

The repository still contains no secrets: the OAuth token is created per user
and stored under `~/.mcp-auth/` on the user's machine.

## 3. npm registry

Best for public or organization-wide distribution without Git access.

### Prepare the manifest

`package.json` is currently private and unlicensed for publication. Before the
first publish:

- remove `"private": true`;
- choose a license and set `"license"` (`UNLICENSED` is allowed for a
  proprietary package);
- add `"repository"`, `"homepage"`, and `"bugs"` if the package is public;
- for a scoped name, add `"publishConfig": { "access": "public" }`;
- keep `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` and `files`;
- keep `mcp-remote` as a runtime dependency.

The unscoped name `dsh-remote-device-hub` is currently available on npm. A
scoped name such as `@xdistribute/dsh-remote-device-hub` avoids collisions if
the organization owns that scope.

### Publish

```bash
npm login
npm run check
npm pack --dry-run        # inspect the exact file list
npm publish               # add --access public for a scoped package
npm view dsh-remote-device-hub version
```

Use a new version for every release (`npm version patch|minor|major`), commit
the bump, tag it, and push the tag. A GitHub Actions release workflow can run
the same commands with `NPM_TOKEN` and `npm publish --provenance`.

### Users install

From **Plugins**, install the package name, optionally with an exact version:

```text
dsh-remote-device-hub
dsh-remote-device-hub@0.1.0
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

A minimal index for this plugin:

```json
{
  "format": 1,
  "title": { "en": "Remote Device Hub", "zh": "Remote Device Hub" },
  "description": {
    "en": "Remote device access for DeepSeek Harness.",
    "zh": "为 DeepSeek Harness 提供远程设备访问。"
  },
  "metadata": {
    "categories": { "remote": { "title": { "en": "Remote", "zh": "远程" } } },
    "labels": {},
    "sortKeys": {}
  },
  "plugins": [
    {
      "name": "dsh-remote-device-hub",
      "title": { "en": "Remote Device Hub", "zh": "Remote Device Hub" },
      "description": {
        "en": "Connect authorized Linux and macOS devices through MCP.",
        "zh": "通过 MCP 连接已授权的 Linux 和 macOS 设备。"
      },
      "icon": "https://example.com/remote-device-hub/icon.png",
      "author": "Hongfei Shang",
      "homepage": "https://github.com/just-one-click/remote-device-plugin-dsh",
      "repository": {
        "url": "https://github.com/just-one-click/remote-device-plugin-dsh"
      },
      "metadata": {
        "category": "remote",
        "keywords": ["mcp", "remote-device", "dsh"],
        "labels": [],
        "sortKeys": {}
      },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1792464000,
          "source": { "type": "npm" },
          "engines": { "dsh": ">=0.2.0" }
        }
      ]
    }
  ]
}
```

For a Git source, `source` is `{ "type": "git", "url": "https://github.com/.../repo.git", "commit": "<40-hex-sha>", "path": "" }`.
The commit must be a lowercase 40-hex SHA, and the URL must be a canonical
public HTTPS URL without credentials. A private repository is not usable as a
market Git source for users who lack access, and raw private GitHub URLs cannot
be fetched by the market reader.

Host the index over public HTTPS. GitHub Pages or a CDN works; a raw GitHub URL
redirects, and the market reader refuses redirects. Add the final index URL in
**Settings → Plugins → Discover** (or the equivalent index-source field).

`plugin_market` can only read indexes the user already configured; it cannot
add a source. Discoverability therefore needs the user to add the index URL
once.

## Release checklist

1. Update the version in `package.json`; commit.
2. Run `npm run check`.
3. Verify `npm pack --dry-run` contains `index.js`, `bin/launcher.mjs`,
   `cordis.patch.yml`, `locale/`, `assets/`, and `skills/`.
4. Tag the release (`git tag -a vX.Y.Z`) and push the commit and tag.
5. Publish to the chosen channel (GitHub spec, npm, or a market index).
6. Install from a clean profile in the chosen channel and call
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
