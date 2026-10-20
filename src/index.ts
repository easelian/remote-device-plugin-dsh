/**
 * Host half of the Remote Device Hub bundle.
 *
 * It contributes two pieces that do not depend on the MCP connection itself:
 *   - the `remote-device-hub` skill, when this profile mounts the skill
 *     registry;
 *   - a `tools/pre-execute` gate that asks for approval before a Remote Device
 *     Hub tool can change a device, when this profile has an approval channel.
 *
 * The MCP server itself is mounted by the bundle patch through
 * `@deepseek-ai/dsh-mcp-client` and the stdio launcher in `bin/`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

const PLUGIN_NAME = 'dsh-remote-device-hub'
const PROVIDER_NAME = 'dsh-remote-device-hub'
const SKILL_NAME = 'remote-device-hub'
const SKILL_DIRECTORY = new URL('./skills/remote-device-hub/', import.meta.url)
const SKILL_PATH = fileURLToPath(new URL('./SKILL.md', SKILL_DIRECTORY))
const RESOURCE_BASE = { kind: 'directory', path: fileURLToPath(SKILL_DIRECTORY) }
const INVOCATION = { modelInvocable: true, userInvocable: true }
const DESCRIPTION = 'Manage Linux and macOS devices enrolled with Remote Device Hub. Use for device status, bounded file reads and edits, remote commands, and Agent-managed jobs after the user identifies the intended device and task.'
const BUNDLED_SKILL_RANK = 600

interface RowConfig {
  serverName?: unknown
  permissionMode?: unknown
  confirmMutations?: unknown
}

interface ToolExecution {
  name?: unknown
  args?: unknown
}

interface ApprovalDecision {
  kind: 'ask'
  reason: string
  displayReason: { en: string; zh: string }
}

interface SkillCandidate {
  name: string
  description: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  provider: string
  source: string
  rank: number
  resourceBase: { kind: string; path: string }
  locator: string
}

interface SkillProvider {
  name: string
  list(): Promise<SkillCandidate[]>
  get(candidate: SkillCandidate, options?: { signal?: AbortSignal }): Promise<Omit<SkillCandidate, 'rank' | 'locator'> & { content: string }>
}

interface SkillRegistry { registerProvider(factory: () => SkillProvider): unknown }
interface SkillScope {
  skills?: SkillRegistry
  get?(name: string): unknown
}
interface HostContext extends SkillScope {
  get(name: string): unknown
  inject?(services: string[], callback: (scope: SkillScope) => void): unknown
  on(event: 'tools/pre-execute', callback: (exec: unknown, next: () => unknown) => Promise<unknown>): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSkillRegistry(value: unknown): value is SkillRegistry {
  return isRecord(value) && typeof value.registerProvider === 'function'
}

/** Permission levels offered on the Plugins row page. */
export const PERMISSION_MODES = ['always-ask', 'read-only', 'low-risk', 'allow-all'] as const
export type PermissionMode = typeof PERMISSION_MODES[number]
function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some(mode => mode === value)
}
const DEFAULT_PERMISSION_MODE = 'read-only'

/**
 * Row configuration. `permissionMode` is volatile, so DSH Settings can expose
 * it as the row's form field. `confirmMutations` is the legacy boolean kept for
 * profiles written before the permission levels existed.
 */
export const Config = z.object({
  serverName: z.string().default('remote-device-hub'),
  permissionMode: z.union(PERMISSION_MODES.map((mode) => z.const(mode))).volatile(),
  confirmMutations: z.boolean().default(true).volatile(),
})

/**
 * Remote Device Hub tools that only read device or account state. Every other
 * tool, including tools added by future Agents, is treated as a mutation and
 * goes through the approval gate.
 */
export const READ_ONLY_TOOLS = new Set([
  'list_devices',
  'get_billing_status',
  'device_info',
  'list_directory',
  'read_file',
  'read_file_chunk',
  'read_multiple_files',
  'search_files',
  'file_info',
  'start_search',
  'list_searches',
  'get_search_results',
  'read_process',
  'list_processes',
])

/**
 * Low-risk tools: read-only calls plus operations that cannot overwrite data
 * and are cheap to undo. Everything else, including shell execution, file
 * writes, moves, and process termination, asks in `low-risk` mode.
 */
export const LOW_RISK_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'make_directory',
  'stop_search',
])

/** Read a plain or schemastery-volatile config value. */
function configValue(value: unknown): unknown {
  return isRecord(value) && typeof value.get === 'function'
    ? value.get()
    : value
}

/** Resolve the effective permission mode, including the legacy boolean. */
export function resolvePermissionMode(config: RowConfig = {}): PermissionMode {
  const mode = configValue(config.permissionMode)
  if (isPermissionMode(mode)) return mode
  if (configValue(config.confirmMutations) === false) return 'allow-all'
  return DEFAULT_PERMISSION_MODE
}

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  rank: BUNDLED_SKILL_RANK,
  resourceBase: RESOURCE_BASE,
  locator: SKILL_PATH,
}

/** Cordis plugin name. */
export const name = PLUGIN_NAME

function stripFrontmatter(raw: string, path: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (!match) throw new Error(`${PLUGIN_NAME}: ${path} has no YAML frontmatter`)
  return raw.slice(match[0].length).trim()
}

function createProvider(): SkillProvider {
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([CANDIDATE]),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator, { encoding: 'utf8', signal: options?.signal })
      return { ...summary, content: stripFrontmatter(raw, locator) }
    },
  }
}

/**
 * Decide whether one tool call needs approval.
 * Returns `null` when the call is not a Remote Device Hub mutation or no
 * approval channel exists; otherwise returns the `ask` decision.
 */
export function mutationDecision(execution: unknown, options: {
  serverName?: string
  approvalAvailable?: boolean
  permissionMode?: PermissionMode
} = {}): ApprovalDecision | null {
  const exec: ToolExecution = isRecord(execution) ? execution : {}
  const args = isRecord(exec.args) ? exec.args : {}
  const serverName = options.serverName ?? 'remote-device-hub'
  const approvalAvailable = options.approvalAvailable === true
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE
  const prefix = `mcp__${serverName}__`
  const toolName = typeof exec?.name === 'string' ? exec.name : ''
  if (!toolName.startsWith(prefix)) return null
  const tool = toolName.slice(prefix.length)
  if (permissionMode === 'allow-all') return null
  if (permissionMode === 'read-only') {
    if (READ_ONLY_TOOLS.has(tool)) return null
  } else if (permissionMode === 'low-risk') {
    if (LOW_RISK_TOOLS.has(tool)) return null
    // A write with an empty expected hash is create-only: it cannot replace an
    // existing file. Overwriting still requires a hash and stays gated.
    if (tool === 'write_file' && (args.expected_sha256 ?? '') === '') return null
  }
  if (!approvalAvailable) return null

  const rawDevice = args.device_id
  const device = typeof rawDevice === 'string' && rawDevice.length > 0 ? rawDevice : undefined
  const target = device === undefined ? 'the selected device' : `device ${device}`
  return {
    kind: 'ask',
    reason: `Remote Device Hub will run ${tool} on ${target}.`,
    displayReason: {
      en: `Allow Remote Device Hub to run ${tool} on ${target}?`,
      zh: `允许 Remote Device Hub 在${device === undefined ? '所选设备' : `设备 ${device}`}上执行 ${tool} 吗？`,
    },
  }
}

/**
 * Register the skill (when available) and the mutation approval gate.
 * @param ctx - Cordis context.
 * @param config - Row config: `serverName`, `permissionMode`, and the legacy
 * `confirmMutations`.
 */
export function apply(ctx: HostContext, config: RowConfig = {}): void {
  const serverName = typeof config.serverName === 'string' && config.serverName.length > 0
    ? config.serverName
    : 'remote-device-hub'

  const registerSkill = (scope: SkillScope) => {
    const skills = scope.skills ?? (typeof scope.get === 'function' ? scope.get('skills') : undefined)
    if (!isSkillRegistry(skills)) return
    skills.registerProvider(() => createProvider())
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['skills'], registerSkill)
  } else {
    registerSkill(ctx)
  }

  ctx.on('tools/pre-execute', async (exec, next) => {
    let approval
    try {
      approval = ctx.get('approval')
    } catch {
      approval = undefined
    }
    const decision = mutationDecision(exec, {
      serverName,
      approvalAvailable: approval != null,
      permissionMode: resolvePermissionMode(config),
    })
    return decision ?? next()
  })
}
