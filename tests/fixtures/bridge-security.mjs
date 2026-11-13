// Run in a disposable Secret Service session, with an isolated MCP_REMOTE_CONFIG_DIR.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { secureStore } from '../../bin/secure-store.mjs';
import { NodeOAuthClientProvider, parseCommandLineArgs } from '../../bin/bridge/chunk-KJCT2FXL.js';

const privateAccess = 'test-access-must-not-leak';
const privateRefresh = 'test-refresh-must-not-leak';
let refreshes = 0;
let currentRefresh = privateRefresh;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const params = new URLSearchParams(body);
  assert.equal(params.get('refresh_token'), currentRefresh);
  refreshes++;
  await new Promise((resolve) => setTimeout(resolve, 250));
  currentRefresh = `rotated-${refreshes}`;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      access_token: `access-${refreshes}`,
      refresh_token: currentRefresh,
      token_type: 'Bearer',
      expires_in: 3600,
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const endpoint = `${origin}/mcp`;
const options = {
  serverUrl: origin,
  resourceServerUrl: endpoint,
  serverUrlHash: 'fixture',
  callbackPort: 3335,
  authorizationServerMetadata: {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ['code'],
  },
};
const provider = new NodeOAuthClientProvider(options);
const logs = [];
const write = process.stderr.write;
process.stderr.write = (text) => {
  logs.push(String(text));
  return true;
};
try {
  await secureStore.ready();
  await parseCommandLineArgs([endpoint, '3335', '--debug'], 'test');
  await provider.saveClientInformation({
    ...provider.clientMetadata,
    client_id: 'fixture-client',
    client_secret: 'fixture-client-secret',
  });
  await provider.saveTokens({
    access_token: privateAccess,
    refresh_token: privateRefresh,
    token_type: 'Bearer',
  });
  assert.equal((await provider.tokens()).access_token, privateAccess);
  const restart = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { secureStore } from './bin/secure-store.mjs'; const value = await secureStore.read('fixture', 'tokens.json'); if (JSON.parse(value).access_token !== 'test-access-must-not-leak') process.exit(1);`,
    ],
    { env: process.env, encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(restart.status, 0, restart.stderr);
  await provider.saveCodeVerifier('fixture-private-verifier');
  assert.equal(await provider.codeVerifier(), 'fixture-private-verifier');
  for (const name of await readdir(secureStore.directory)) {
    const bytes = await readFile(join(secureStore.directory, name));
    for (const secret of [
      privateAccess,
      privateRefresh,
      'fixture-client-secret',
      'fixture-private-verifier',
    ]) {
      assert.equal(bytes.includes(Buffer.from(secret)), false, name);
    }
  }
  assert.equal(logs.join('').includes(privateAccess), false);
  assert.equal(logs.join('').includes(privateRefresh), false);
  await provider.saveTokens({
    access_token: privateAccess,
    refresh_token: privateRefresh,
    token_type: 'Bearer',
    expires_in: 1,
  });
  const sibling = new NodeOAuthClientProvider(options);
  const results = await Promise.all([provider.tokens(), sibling.tokens()]);
  assert.equal(refreshes, 1);
  assert.equal(results[0].access_token, 'access-1');
  assert.equal(results[1].access_token, 'access-1');
  await provider.invalidateCredentials('all');
  assert.equal(await sibling.tokens(), undefined);
  console.log(
    'PASS: native keyring, encrypted OAuth records, debug redaction, concurrent rotating refresh, credential invalidation',
  );
} finally {
  process.stderr.write = write;
  await new Promise((resolve) => server.close(resolve));
}
