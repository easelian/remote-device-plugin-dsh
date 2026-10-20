#!/usr/bin/env node
/**
 * Generate the format-1 plugin market index for one distribution source.
 *
 *   npm run market
 *   npm run market -- --source git --commit <40-hex-sha> --out market/index.git.json
 *
 * The default output is `market/index.json` for npm and `market/index.git.json`
 * for a Git source. Existing versions in that output are preserved so the
 * market keeps older releases installable.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_INLINE_ICON_BYTES, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { rcompare } from 'semver'
import type { MarketIndex, MarketSource, MarketVersion } from '@deepseek-ai/dsh-plugin-market-index'
import { packageManifest, parseJson, record } from './json.mjs'

const ROOT = new URL('../', import.meta.url)
const PACKAGE_PATH = new URL('package.json', ROOT)
const ICON_PATH = new URL('assets/icon.png', ROOT)
const DEFAULT_GIT_URL = 'https://github.com/be-one-click/remote-device-plugin-dsh.git'

interface Options {
  source?: string
  commit?: string
  out?: string
  version?: string
  'published-at'?: string
  'git-url'?: string
  path?: string
  preserve?: false
}

export function parseArgs(argv: string[]): Options {
  const options: Options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined || !arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const key = arg.slice(2)
    if (key === 'no-preserve') {
      options.preserve = false
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
    if (key !== 'source' && key !== 'commit' && key !== 'out' && key !== 'version' && key !== 'published-at' && key !== 'git-url' && key !== 'path') {
      throw new Error(`Unknown option: ${arg}`)
    }
    options[key] = value
    index += 1
  }
  return options
}

function gitCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(ROOT), encoding: 'utf8' }).trim()
}

function resolveOutput(source: 'npm' | 'git', out: string | undefined): string {
  if (out === undefined) return source === 'git' ? 'market/index.git.json' : 'market/index.json'
  return isAbsolute(out) ? out : resolve(fileURLToPath(ROOT), out)
}

function validCommit(commit: string): boolean {
  return /^[0-9a-f]{40}$/u.test(commit)
}

function dataIcon(bytes: Buffer): string {
  if (bytes.byteLength > MAX_INLINE_ICON_BYTES) {
    throw new Error(`assets/icon.png is ${bytes.byteLength} bytes; inline market icons are limited to ${MAX_INLINE_ICON_BYTES}`)
  }
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function currentVersion(pkg: ReturnType<typeof packageManifest>, options: Options): string {
  const version = options.version ?? pkg.version
  if (typeof version !== 'string' || version.length === 0) throw new Error('package.json has no version')
  return version
}

async function readExisting(out: string): Promise<MarketIndex | undefined> {
  try {
    return parseMarketIndex(parseJson(await readFile(out, 'utf8')), 'https://market.invalid/index.json')
  } catch (error) {
    if (record(error).code === 'ENOENT') return undefined
    throw new Error(`Cannot read existing market index ${out}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

function mergeVersions(existing: MarketIndex | undefined, current: MarketVersion): MarketVersion[] {
  const previous = existing?.plugins?.[0]?.versions
  const versions = Array.isArray(previous)
    ? previous.filter((version) => version?.version !== current.version)
    : []
  return [current, ...versions].sort((left, right) => rcompare(left.version, right.version))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const source = options.source ?? (options.commit ? 'git' : 'npm')
  if (source !== 'npm' && source !== 'git') throw new Error('--source must be npm or git')

  const pkg = packageManifest(parseJson(await readFile(PACKAGE_PATH, 'utf8')))
  const out = resolveOutput(source, options.out)
  const version = currentVersion(pkg, options)
  const publishedAt = options['published-at'] === undefined
    ? Math.floor(Date.now() / 1000)
    : Number(options['published-at'])
  if (!Number.isInteger(publishedAt) || publishedAt <= 0) throw new Error('--published-at must be a positive Unix timestamp')

  const sourceSpec: MarketSource = source === 'npm'
    ? { type: 'npm' }
    : (() => {
      const url = options['git-url'] ?? DEFAULT_GIT_URL
      const commit = options.commit ?? gitCommit()
      if (!validCommit(commit)) throw new Error('--commit must be a lowercase 40-hex commit SHA')
      if (!/^https:\/\/[^\s]+$/u.test(url)) throw new Error('--git-url must be an absolute https URL without credentials')
      return options.path === undefined
        ? { type: 'git', url, commit }
        : { type: 'git', url, commit, path: options.path }
    })()

  const existing = options.preserve === false ? undefined : await readExisting(out)
  const previousTimestamp = existing?.plugins?.[0]?.versions
    ?.find((entry) => entry?.version === version)?.publishTimestamp
  const timestamp = typeof previousTimestamp === 'number' && Number.isInteger(previousTimestamp) ? previousTimestamp : publishedAt

  const current: MarketVersion = {
    version,
    publishTimestamp: timestamp,
    source: sourceSpec,
    engines: typeof pkg.engines?.dsh === 'string' ? { dsh: pkg.engines.dsh } : {},
  }

  const icon = dataIcon(await readFile(ICON_PATH))
  const versions = mergeVersions(existing, current)
  const index = {
    format: 1,
    title: { en: 'Remote Device Hub', zh: 'Remote Device Hub' },
    description: {
      en: 'Remote Device Hub integrations for DeepSeek Harness.',
      zh: 'DeepSeek Harness 的 Remote Device Hub 集成。',
    },
    metadata: {
      categories: { remote: { title: { en: 'Remote', zh: '远程' } } },
      labels: {},
      sortKeys: {},
    },
    plugins: [
      {
        name: pkg.name,
        title: { en: 'Remote Device Hub', zh: 'Remote Device Hub' },
        description: {
          en: 'Connect authorized Linux and macOS devices through MCP, with an operations skill and mutation approvals.',
          zh: '通过 MCP 连接已授权的 Linux 和 macOS 设备，提供操作技能并在更改设备前请求批准。',
        },
        icon,
        author: pkg.author,
        homepage: pkg.homepage,
        repository: { url: DEFAULT_GIT_URL.replace(/\.git$/u, '') },
        metadata: {
          category: 'remote',
          keywords: ['mcp', 'remote-device', 'dsh'],
          labels: [],
          sortKeys: {},
        },
        versions,
      },
    ],
  }

  // The official parser is the contract; fail before writing an invalid index.
  parseMarketIndex(index, 'https://market.invalid/index.json')
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(index, undefined, 2)}\n`)
  console.log(`market: wrote ${out} (${source}, ${version}, ${versions.length} version(s))`)
  console.log(`market: icon ${icon.length} bytes as a data URI`)
  if (source === 'git') console.log('market: host this file at a public HTTPS URL that does not redirect')
}

try {
  await main()
} catch (error) {
  console.error(`market: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
