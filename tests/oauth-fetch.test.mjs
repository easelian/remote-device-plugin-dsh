import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { PUBLIC_ORIGIN, resolveConfig } from '../bin/config.mjs';
import { directURL, wrap } from '../bin/oauth-fetch.mjs';

const publicOrigin = 'https://hub.example';
const directOrigin = 'https://direct.example:8443';
const config = resolveConfig({
  RDH_MCP_URL: `${publicOrigin}/mcp`,
  RDH_DIRECT_ORIGIN: directOrigin,
});

test('default preload leaves global fetch untouched and does not load undici', () => {
  const env = { ...process.env };
  for (const key of ['RDH_MCP_URL', 'RDH_PUBLIC_ORIGIN', 'RDH_DIRECT_ORIGIN']) {
    delete env[key];
  }
  const preload = new URL('../bin/oauth-fetch.mjs', import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';
       import { createRequire } from 'node:module';
       const require = createRequire(import.meta.url);
       const before = globalThis.fetch;
       const cache = Object.keys(require.cache);
       const { directURL } = await import(${JSON.stringify(preload)});
       assert.equal(globalThis.fetch, before);
       assert.deepEqual(Object.keys(require.cache), cache);
       assert.equal(directURL(${JSON.stringify(`${PUBLIC_ORIGIN}/token`)}), undefined);`,
    ],
    { env },
  );
});

test('only configured OAuth/MCP routes are rewritten', () => {
  for (const input of [null, undefined, {}, [], { url: 5 }, 'not a URL']) {
    assert.equal(directURL(input, config), undefined);
  }
  for (const suffix of [
    '/authorize',
    '/account',
    '/mcp-other',
    '/token-other',
    '/.well-known/oauth-protected-resource-other',
  ]) {
    assert.equal(directURL(`${publicOrigin}${suffix}`, config), undefined);
  }
  assert.equal(directURL('https://other.invalid/token', config), undefined);
  assert.equal(directURL('https://user:secret@hub.example/token', config), undefined);
  for (const suffix of [
    '/token',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    assert.equal(
      directURL(new URL(`${publicOrigin}${suffix}?a=b`), config),
      `${directOrigin}${suffix}?a=b`,
    );
  }
});

test('custom endpoint paths and separate explicit OAuth origins stay scoped', () => {
  const custom = resolveConfig({
    RDH_MCP_URL: 'https://custom.example/tenant/mcp?key=a',
    RDH_PUBLIC_ORIGIN: 'https://auth.example',
    RDH_DIRECT_ORIGIN: directOrigin,
  });
  assert.equal(directURL(custom.endpoint, custom), `${directOrigin}/tenant/mcp?key=a`);
  assert.equal(directURL('https://auth.example/token', custom), `${directOrigin}/token`);
  assert.equal(
    directURL('https://custom.example/.well-known/oauth-protected-resource/tenant/mcp', custom),
    `${directOrigin}/.well-known/oauth-protected-resource/tenant/mcp`,
  );
  for (const input of [
    `${PUBLIC_ORIGIN}/mcp`,
    `${PUBLIC_ORIGIN}/token`,
    'https://custom.example/token',
    'https://custom.example/mcp',
    'https://auth.example/tenant/mcp',
  ]) {
    assert.equal(directURL(input, custom), undefined);
  }
  assert.equal(directURL(`${publicOrigin}/token`, resolveConfig({})), undefined);
});

test('fetch wrapping is idempotent and forwards method/body/headers without changes', async () => {
  const calls = [];
  const response = new Response('{}');
  const base = async (input, init) => {
    calls.push([input, init]);
    return response;
  };
  const wrapped = wrap(base, config);
  assert.equal(wrap(wrapped, config), wrapped);
  const init = {
    method: 'POST',
    body: 'grant_type=refresh_token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  assert.equal(await wrapped(`${publicOrigin}/token`, init), response);
  assert.equal(calls[0][0], `${directOrigin}/token`);
  assert.equal(calls[0][1], init);
  const request = new Request(`${publicOrigin}/token`, init);
  await wrapped(request);
  assert.equal(calls[1][0].url, `${directOrigin}/token`);
  assert.equal(calls[1][0].method, 'POST');
  assert.equal(calls[1][0].headers.get('content-type'), init.headers['content-type']);
  assert.equal(await calls[1][0].text(), init.body);
  await wrapped('https://other.invalid/token', init);
  assert.equal(calls[2][0], 'https://other.invalid/token');
});

test('failed direct requests are never replayed to the public origin', async () => {
  for (const path of ['/token', '/mcp']) {
    const directError = new Error('connection lost after possible delivery');
    const calls = [];
    const wrapped = wrap(async (input) => {
      calls.push(input);
      throw directError;
    }, config);
    await assert.rejects(
      wrapped(`${publicOrigin}${path}`, { method: 'POST', body: 'payload' }),
      (error) => error === directError,
    );
    assert.deepEqual(calls, [`${directOrigin}${path}`]);
  }
});
