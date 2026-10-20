/** Keep JSON parsing at an unknown boundary, including development inputs. */
export function parseJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw)
  return value
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const entries: unknown[] = value
  return entries.filter((entry): entry is string => typeof entry === 'string')
}

export function packageManifest(value: unknown) {
  const raw = record(value)
  if (typeof raw.name !== 'string' || typeof raw.version !== 'string') {
    throw new Error('package.json needs string name and version fields')
  }
  const dsh = record(raw.dsh)
  const client = record(dsh.client)
  const author = typeof raw.author === 'string' ? raw.author : record(raw.author).name
  return {
    name: raw.name,
    version: raw.version,
    private: raw.private,
    type: raw.type,
    files: strings(raw.files),
    dependencies: record(raw.dependencies),
    exports: record(raw.exports),
    engines: record(raw.engines),
    author: typeof author === 'string' ? author : undefined,
    homepage: typeof raw.homepage === 'string' ? raw.homepage : undefined,
    dsh: {
      bundle: record(dsh.bundle),
      client: { platform: client.platform, inject: strings(client.inject) },
    },
  }
}
