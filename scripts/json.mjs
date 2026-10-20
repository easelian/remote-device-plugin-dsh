/** Keep JSON parsing at an unknown boundary, including development inputs. */
export function parseJson(raw) {
    const value = JSON.parse(raw);
    return value;
}
export function record(value) {
    return isRecord(value) ? value : {};
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value) {
    if (!Array.isArray(value))
        return [];
    const entries = value;
    return entries.filter((entry) => typeof entry === 'string');
}
export function packageManifest(value) {
    const raw = record(value);
    if (typeof raw.name !== 'string' || typeof raw.version !== 'string') {
        throw new Error('package.json needs string name and version fields');
    }
    const dsh = record(raw.dsh);
    const client = record(dsh.client);
    const author = typeof raw.author === 'string' ? raw.author : record(raw.author).name;
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
    };
}
