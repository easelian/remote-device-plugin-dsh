import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const raw = JSON.parse(await readFile(new URL('../market/index.json', import.meta.url), 'utf8'))
const index = parseMarketIndex(raw, 'https://market.invalid/index.json')

test('the npm market index lists this package and version', () => {
  const plugin = index.plugins.find((entry) => entry.name === manifest.name)
  assert.ok(plugin, 'plugin is listed')
  const version = plugin.versions.find((entry) => entry.version === manifest.version)
  assert.ok(version, 'current version is listed')
  assert.equal(version.source.type, 'npm')
  assert.deepEqual(version.engines, { dsh: manifest.engines.dsh })
})

test('the market install target is the package and exact version', () => {
  const plugin = index.plugins.find((entry) => entry.name === manifest.name)
  const version = plugin.versions.find((entry) => entry.version === manifest.version)
  const target = marketInstallTarget(plugin.name, version)
  assert.equal(target.spec, `${manifest.name}@${manifest.version}`)
  assert.equal(target.registry, undefined)
})

test('the market icon is a bounded inline PNG', () => {
  const plugin = index.plugins.find((entry) => entry.name === manifest.name)
  assert.match(plugin.icon, /^data:image\/png;base64,/u)
  const bytes = Buffer.from(plugin.icon.split(',')[1], 'base64')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.ok(bytes.byteLength <= 32 * 1024)
})
