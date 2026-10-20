import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const readBytes = (path) => readFile(new URL(path, import.meta.url))

test('the package declares a DSH bundle and its runtime files', async () => {
  const manifest = JSON.parse(await read('../package.json'))
  assert.equal(manifest.name, 'dsh-remote-device-hub')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.engines.dsh, '>=0.2.0')
  assert.ok(manifest.dependencies['mcp-remote'])
  for (const path of [
    'index.js',
    'bin/launcher.mjs',
    'bin/oauth-fetch.mjs',
    'bin/config.mjs',
    'cordis.patch.yml',
    'locale/en.json',
    'locale/zh.json',
    'skills/remote-device-hub/SKILL.md',
    'README.md',
    'README.zh.md',
    'LICENSE',
  ]) {
    await stat(new URL(`../${path}`, import.meta.url))
  }
})

test('the patch mounts the MCP bridge and the Host half', async () => {
  const patch = await read('../cordis.patch.yml')
  assert.match(patch, /@deepseek-ai\/dsh-mcp-client/u)
  assert.match(patch, /serverName: remote-device-hub/u)
  assert.match(patch, /https:\/\/mcp\.xdistribute\.site\/mcp/u)
  assert.match(patch, /node_modules\/dsh-remote-device-hub\/bin\/launcher\.mjs/u)
  assert.match(patch, /ELECTRON_RUN_AS_NODE: '1'/u)
  assert.match(patch, /name: dsh-remote-device-hub/u)
  assert.match(patch, /confirmMutations: true/u)
})

test('locale resources carry display metadata', async () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(await read(`../locale/${locale}.json`))
    assert.equal(data.meta.title, 'Remote Device Hub')
    assert.ok(data.meta.description.length > 20)
  }
})

test('the icon is a small valid PNG', async () => {
  const icon = await readBytes('../assets/icon.png')
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(icon.byteLength <= 256 * 1024)
})

test('the bundled skill has valid frontmatter', async () => {
  const body = await read('../skills/remote-device-hub/SKILL.md')
  const match = /^---\n([\s\S]*?)\n---/u.exec(body)
  assert.ok(match, 'frontmatter is present')
  assert.match(match[1], /^name: remote-device-hub$/mu)
  assert.match(match[1], /^description: .{40,}$/mu)
  for (const reference of ['files.md', 'processes.md', 'recovery.md']) {
    await stat(new URL(`../skills/remote-device-hub/references/${reference}`, import.meta.url))
  }
})

test('the repository does not depend on a build step', async () => {
  const manifest = JSON.parse(await read('../package.json'))
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.scripts.build, undefined)
  assert.ok(manifest.devDependencies['@deepseek-ai/dsh-plugin-market-index'])
  assert.ok(root.endsWith('/'))
})
