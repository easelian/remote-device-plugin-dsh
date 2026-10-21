#!/usr/bin/env node
/**
 * Static checks for the bundle before it is installed or pushed.
 * Runtime behavior is covered by `node --test tests/`.
 */

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { packageManifest, parseJson, record } from './json.mjs';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');
const exists = async (path: string) => {
  try {
    await stat(new URL(path, root));
    return true;
  } catch {
    return false;
  }
};

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) {
    failures.push(message);
  }
};

const required = [
  'package.json',
  'cordis.patch.yml',
  'index.js',
  'permissions.js',
  'client.js',
  'bin/launcher.mjs',
  'bin/oauth-fetch.mjs',
  'bin/config.mjs',
  'locale/en.json',
  'locale/zh.json',
  'assets/icon.png',
  'skills/remote-device-hub/SKILL.md',
  'skills/remote-device-hub/references/files.md',
  'skills/remote-device-hub/references/processes.md',
  'skills/remote-device-hub/references/recovery.md',
  'README.md',
  'README.zh.md',
  'docs/architecture.md',
  'docs/troubleshooting.md',
  'docs/publishing.md',
  'market/index.json',
  'LICENSE',
];
for (const path of required) {
  check(await exists(path), `missing ${path}`);
}

const manifest = packageManifest(parseJson(await read('package.json')));
check(manifest.name === 'dsh-remote-device-hub', 'package name must be dsh-remote-device-hub');
check(manifest.private !== true, 'package must be publishable (remove private: true)');
check(manifest.type === 'module', 'package must be ESM');
check(
  manifest.dsh?.bundle?.patch === './cordis.patch.yml',
  'dsh.bundle.patch must point at cordis.patch.yml',
);
check(manifest.engines?.dsh === '>=0.2.0', 'engines.dsh must declare the supported runtime');
check(Boolean(manifest.dependencies?.['mcp-remote']), 'mcp-remote must be a runtime dependency');
check(manifest.files?.includes('bin/*.mjs'), 'files must include the launcher and OAuth preload');
check(manifest.files?.includes('index.js'), 'files must include the Host half');
check(manifest.files?.includes('client.js'), 'files must include the Client half');
check(manifest.exports?.['./client'] === './client.js', 'exports must expose ./client');
check(manifest.dsh?.client?.platform === 'web', 'dsh.client.platform must be web');
check(
  manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-plugin-manager'),
  'dsh.client must inject the plugin manager',
);
check(
  Boolean(manifest.dependencies?.['@deepseek-ai/schemastery']),
  'schemastery must be a runtime dependency',
);
check(manifest.files?.includes('skills/**'), 'files must include the skill tree');
check(manifest.files?.includes('market/*.json'), 'files must include the market index');

const patch = await read('cordis.patch.yml');
for (const token of [
  '@deepseek-ai/dsh-mcp-client',
  'serverName: remote-device-hub',
  'https://mcp.xdistribute.site/mcp',
  'node_modules/dsh-remote-device-hub/bin/launcher.mjs',
  "ELECTRON_RUN_AS_NODE: '1'",
  'name: dsh-remote-device-hub',
  'confirmMutations: true',
]) {
  check(patch.includes(token), `cordis.patch.yml is missing ${token}`);
}

for (const locale of ['en', 'zh']) {
  const meta = record(record(parseJson(await read(`locale/${locale}.json`))).meta);
  check(meta.title === 'Remote Device Hub', `${locale}.json needs meta.title`);
  check(
    typeof meta.description === 'string' && meta.description.length > 20,
    `${locale}.json needs a meaningful meta.description`,
  );
}

const icon = await readFile(new URL('assets/icon.png', root));
check(icon.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'assets/icon.png is not a PNG');
check(icon.byteLength <= 256 * 1024, 'assets/icon.png exceeds the 256 KiB plugin icon limit');

const skill = await read('skills/remote-device-hub/SKILL.md');
check(/^---\nname: remote-device-hub\n/u.test(skill), 'skill frontmatter name is missing');
check(
  /^description: .{40,}$/mu.test(skill),
  'skill frontmatter description is missing or too short',
);

try {
  const market = parseMarketIndex(
    parseJson(await read('market/index.json')),
    'https://market.invalid/index.json',
  );
  const plugin = market.plugins.find((entry) => entry.name === manifest.name);
  check(plugin !== undefined, 'market/index.json does not list this package');
  check(
    plugin?.versions.some((version) => version.version === manifest.version),
    'market/index.json does not list the current version',
  );
  check(
    plugin?.versions.every(
      (version) => version.source.type === 'npm' || version.source.type === 'git',
    ),
    'market/index.json has an unknown source type',
  );
} catch (error) {
  check(
    false,
    `market/index.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const readme = await read('README.md');
for (const link of ['docs/architecture.md', 'docs/troubleshooting.md', 'docs/publishing.md']) {
  check(readme.includes(link), `README.md does not link ${link}`);
}

if (failures.length > 0) {
  console.error(`validate: ${failures.length} problem(s)`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`validate: ok (${fileURLToPath(root)})`);
}
