import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_ORIGIN, DEFAULT_DIRECT_ORIGIN } from '../bin/config.mjs';
import { directURL, wrap } from '../bin/oauth-fetch.mjs';

test('only the configured OAuth/MCP routes are rewritten', () => {
  for (const input of [null, undefined, {}, [], { url: 5 }, 'not a URL']) {
    assert.equal(directURL(input), undefined);
  }
  for (const suffix of ['/authorize', '/account', '/mcp-other', '/token-other']) {
    assert.equal(directURL(`${PUBLIC_ORIGIN}${suffix}`), undefined);
  }
  assert.equal(directURL('https://other.invalid/token'), undefined);
  for (const suffix of [
    '/token',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    assert.equal(
      directURL(new URL(`${PUBLIC_ORIGIN}${suffix}?a=b`)),
      `${DEFAULT_DIRECT_ORIGIN}${suffix}?a=b`,
    );
  }
});

test('fetch wrapping is idempotent and forwards method/body/headers without changes', async () => {
  const calls = [];
  const response = new Response('{}');
  const base = async (input, init) => {
    calls.push([input, init]);
    return response;
  };
  const wrapped = wrap(base);
  assert.equal(wrap(wrapped), wrapped);
  const init = {
    method: 'POST',
    body: 'grant_type=refresh_token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  assert.equal(await wrapped(`${PUBLIC_ORIGIN}/token`, init), response);
  assert.equal(calls[0][0], `${DEFAULT_DIRECT_ORIGIN}/token`);
  assert.equal(calls[0][1], init);
  const request = new Request(`${PUBLIC_ORIGIN}/token`, init);
  await wrapped(request);
  assert.equal(calls[1][0].url, `${DEFAULT_DIRECT_ORIGIN}/token`);
  assert.equal(calls[1][0].method, 'POST');
  assert.equal(calls[1][0].headers.get('content-type'), init.headers['content-type']);
  assert.equal(await calls[1][0].text(), init.body);
});

test('a failed direct route falls back once and preserves the first error if both fail', async () => {
  const directError = new Error('direct unavailable');
  const calls = [];
  const response = new Response('{}');
  const wrapped = wrap(async (input) => {
    calls.push(input);
    if (calls.length === 1) {
      throw directError;
    }
    return response;
  });
  assert.equal(await wrapped(`${PUBLIC_ORIGIN}/mcp`), response);
  assert.deepEqual(calls, [`${DEFAULT_DIRECT_ORIGIN}/mcp`, `${PUBLIC_ORIGIN}/mcp`]);
  let count = 0;
  await assert.rejects(
    wrap(async () => {
      throw ++count === 1 ? directError : new Error('public unavailable');
    })(`${PUBLIC_ORIGIN}/mcp`),
    (error) => error === directError,
  );
  assert.equal(count, 2);
});
