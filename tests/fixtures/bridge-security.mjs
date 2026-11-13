// Run in a disposable Secret Service session, with an isolated MCP_REMOTE_CONFIG_DIR.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { BridgeAuth } from '../../bin/auth.mjs';
import { secureStore } from '../../bin/secure-store.mjs';

let serial = 0;
let refreshes = 0;
const spent = new Set();
let origin;
const read = async (request) => {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
  }
  return text;
};
const reply = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const issue = () => {
  serial += 1;
  return {
    access_token: `test-access-${serial}-must-not-leak`,
    refresh_token: `test-refresh-${serial}-must-not-leak`,
    token_type: 'Bearer',
    expires_in: 3600,
  };
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    reply(response, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
  } else if (url.pathname === '/.well-known/oauth-authorization-server') {
    reply(response, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  } else if (url.pathname === '/register') {
    reply(response, 201, {
      ...JSON.parse(await read(request)),
      client_id: 'fixture-client-must-not-leak',
    });
  } else if (url.pathname === '/authorize') {
    const target = new URL(url.searchParams.get('redirect_uri'));
    target.searchParams.set('code', `code-${url.searchParams.get('code_challenge')}`);
    target.searchParams.set('state', url.searchParams.get('state'));
    response.writeHead(302, { location: target.href }).end();
  } else if (url.pathname === '/token') {
    const form = new URLSearchParams(await read(request));
    if (form.get('grant_type') === 'authorization_code') {
      const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64url');
      assert.equal(form.get('code'), `code-${challenge}`);
      reply(response, 200, issue());
      return;
    }
    // A rotating refresh token works exactly once.
    if (spent.has(form.get('refresh_token'))) {
      reply(response, 400, { error: 'invalid_grant' });
      return;
    }
    spent.add(form.get('refresh_token'));
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    reply(response, 200, issue());
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const endpoint = `${origin}/mcp`;
const opened = [];
const instance = (extra = {}) =>
  new BridgeAuth({
    endpoint,
    store: secureStore,
    port: null,
    openBrowser: async (link) => {
      opened.push(link);
      await fetch(link);
    },
    ...extra,
  });

const logs = [];
const write = process.stderr.write;
process.stderr.write = (text) => {
  logs.push(String(text));
  return true;
};
try {
  await secureStore.ready();
  assert.equal(await instance().accessToken(), 'test-access-1-must-not-leak');
  assert.equal(opened.length, 1);

  // A new process finds the sign-in through the native keyring.
  const restart = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { BridgeAuth } from './bin/auth.mjs'; import { secureStore } from './bin/secure-store.mjs';
       const auth = new BridgeAuth({ endpoint: ${JSON.stringify(endpoint)}, store: secureStore, port: null, openBrowser: async () => process.exit(2) });
       if ((await auth.accessToken()) !== 'test-access-1-must-not-leak') process.exit(1);`,
    ],
    { env: process.env, encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(restart.status, 0, restart.stderr);

  const records = (await readdir(secureStore.directory)).filter((name) => !name.startsWith('.'));
  assert.ok(records.length >= 2);
  for (const name of records) {
    const bytes = await readFile(join(secureStore.directory, name));
    for (const secret of ['test-access-1', 'test-refresh-1', 'fixture-client-must-not-leak']) {
      assert.equal(bytes.includes(Buffer.from(secret)), false, name);
    }
  }

  // Two bridges notice the expiring token together; the refresh token is spent once.
  const later = () => Date.now() + 3_580_000;
  const results = await Promise.all([
    instance({ now: later }).accessToken(),
    instance({ now: later }).accessToken(),
  ]);
  assert.equal(refreshes, 1);
  assert.deepEqual(results, ['test-access-2-must-not-leak', 'test-access-2-must-not-leak']);

  // A refresh token the server rejects ends in one new sign-in, not a loop.
  spent.add('test-refresh-2-must-not-leak');
  const afterExpiry = () => Date.now() + 2 * 3_580_000;
  assert.equal(await instance({ now: afterExpiry }).accessToken(), 'test-access-3-must-not-leak');
  assert.equal(opened.length, 2);

  for (const secret of ['must-not-leak', 'code-']) {
    assert.equal(
      logs.join('').replaceAll(opened[0], '').replaceAll(opened[1], '').includes(secret),
      false,
    );
  }
  console.log(
    'PASS: native keyring, encrypted OAuth records, restart, concurrent rotating refresh, re-sign-in after rejection',
  );
} finally {
  process.stderr.write = write;
  await new Promise((resolve) => server.close(resolve));
}
