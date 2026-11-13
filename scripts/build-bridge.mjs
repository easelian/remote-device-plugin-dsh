/** Build the audited private bridge; never patch a user's shared node_modules at runtime. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const upstream = dirname(require.resolve('mcp-remote/dist/proxy.js'));
const output = fileURLToPath(new URL('../bin/bridge/', import.meta.url));
const audited = {
    'proxy.js': '4548f6f908477c5609ced817a2301b77fcda94cd154a4b9ca764cfd49fbf691c',
    'chunk-KJCT2FXL.js': 'bd626c01947857ba2cb5f347659f8d6db7d99827732a187660bd2582741e4bf0',
    'chunk-MLKGABMK.js': '30c77128186890ab8043f3a2502ab91c7d9dec358dd35ee0d89835189b1caa03',
    'webapi-WW3GGD26.js': 'ec84e09fb4aeb7b465796cc8e9f7788d8e4365d4c63bc5bbcb52876247cb6bc6',
};
function section(source, start, end, replacement) {
    const a = source.indexOf(start);
    const b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0) {
        throw new Error('The audited bridge layout changed; review the credential boundary before upgrading.');
    }
    return source.slice(0, a) + replacement + '\n' + source.slice(b);
}
const files = {};
for (const [name, digest] of Object.entries(audited)) {
    const source = await readFile(join(upstream, name), 'utf8');
    if (createHash('sha256').update(source).digest('hex') !== digest) {
        throw new Error(`Unaudited mcp-remote source: ${name}. Refusing to build a plaintext-capable bridge.`);
    }
    files[name] = source;
}
let source = files['chunk-KJCT2FXL.js'];
source = `import { secureStore, SecureStorageError } from '../secure-store.mjs';
import { bridgeLog } from '../bridge-log.mjs';\n${source}`;
source = section(source, 'function getConfigDir() {', 'function getConfigFilePath(', `function getConfigDir() { return secureStore.directory; }
async function ensureConfigDir() { await secureStore.ready(); }`);
source = section(source, 'async function deleteConfigFile(', 'async function deleteStaleConfigFiles(', `async function deleteConfigFile(server, name) { await secureStore.remove(server, name); }`);
source = section(source, 'async function readJsonFile(', 'var ConfigLeaseSchema =', `async function readJsonFile(server, name, schema) {
  const text = await secureStore.read(server, name);
  if (text === undefined) return undefined;
  try { return await schema.parseAsync(JSON.parse(text)); }
  catch { throw new SecureStorageError(); }
}
async function writeJsonFile(server, name, value) { await secureStore.write(server, name, JSON.stringify(value)); }
async function readTextFile(server, name) {
  const text = await secureStore.read(server, name);
  if (text === undefined) throw new SecureStorageError();
  return text;
}
async function writeTextFile(server, name, value) { await secureStore.write(server, name, value); }`);
source = section(source, 'function debugLog(', 'var MESSAGE_BLOCKED =', `function debugLog() {}
function log(message, ...args) { bridgeLog(message, ...args); }`);
// Never proceed with rotating refresh credentials when coordination cannot be obtained.
source = source.replace('return UNCOORDINATED;', 'throw new SecureStorageError();');
source = source.replace('await rm(getConfigFilePath(serverUrlHash, "client_info.json"), { force: true });', 'await deleteConfigFile(serverUrlHash, "client_info.json");');
files['chunk-KJCT2FXL.js'] = source;
files['proxy.js'] = files['proxy.js'].replace('#!/usr/bin/env node\n', `#!/usr/bin/env node
import { secureStore, STORAGE_ERROR } from '../secure-store.mjs';
// Native backend and third-party errors can embed credential values. Never dump them.
const stopSafely = () => { process.stderr.write('[remote-device-hub] ' + STORAGE_ERROR + '\\n'); process.exit(1); };
process.on('uncaughtException', stopSafely);
process.on('unhandledRejection', stopSafely);
const allowed = new Set(['--transport', '--static-oauth-client-metadata', '--allow-http', '--debug']);
if (process.argv.slice(2).some(arg => arg.startsWith('--') && !allowed.has(arg))) {
  process.stderr.write('[remote-device-hub] Unsupported private bridge option. Use the RDH launcher with browser OAuth.\\n');
  process.exit(1);
}
try { await secureStore.ready(); } catch { stopSafely(); }
`);
await mkdir(output, { recursive: true });
for (const [name, content] of Object.entries(files)) {
    await writeFile(join(output, name), content);
}
await writeFile(join(output, 'LICENSE.mcp-remote'), await readFile(join(upstream, '../LICENSE')));
console.log('Built the pinned secure MCP bridge.');
