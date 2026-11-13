import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { AuthUnavailableError, BridgeAuth, CALLBACK_PATH, SignInError } from '../bin/auth.mjs';
import { authorizedFetch, describeFailure, runBridge } from '../bin/bridge.mjs';
import { withLock } from '../bin/lock.mjs';
import { SecureStore } from '../bin/secure-store.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const body = async (request) => {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
  }
  return text;
};
const json = (response, status, value, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
};

/** A sign-in service and a protected MCP endpoint, as two separate origins. */
async function hub(t, options = {}) {
  const state = {
    registrations: [],
    authorizations: 0,
    tokenRequests: [],
    mcp: [],
    serial: 0,
    valid: new Set(),
    refresh: new Map(),
    failRefresh: undefined,
    lifetime: options.lifetime ?? 3600,
    mcpHandler: undefined,
  };
  let issuer;
  let resource;
  const issue = () => {
    state.serial += 1;
    const access = `access-${state.serial}-secret`;
    const refresh = `refresh-${state.serial}-secret`;
    state.valid.add(access);
    state.refresh.set(refresh, true);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: state.lifetime,
    };
  };
  const auth = createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        registration_endpoint: `${issuer}register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    } else if (url.pathname === '/register') {
      const metadata = JSON.parse(await body(request));
      state.registrations.push(metadata);
      json(response, 201, { ...metadata, client_id: `client-${state.registrations.length}` });
    } else if (url.pathname === '/authorize') {
      state.authorizations += 1;
      const target = new URL(url.searchParams.get('redirect_uri'));
      target.searchParams.set('code', `code-${url.searchParams.get('code_challenge')}`);
      target.searchParams.set('state', url.searchParams.get('state'));
      response.writeHead(302, { location: target.href }).end();
    } else if (url.pathname === '/token') {
      const form = new URLSearchParams(await body(request));
      state.tokenRequests.push(Object.fromEntries(form));
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = createHash('sha256')
          .update(form.get('code_verifier'))
          .digest('base64url');
        if (form.get('code') !== `code-${challenge}`) {
          json(response, 400, { error: 'invalid_grant' });
          return;
        }
        json(response, 200, issue());
        return;
      }
      if (state.failRefresh === 'network') {
        request.socket.destroy();
        return;
      }
      // Rotation: a refresh token works once.
      if (!state.refresh.get(form.get('refresh_token'))) {
        json(response, 400, { error: 'invalid_grant' });
        return;
      }
      state.refresh.set(form.get('refresh_token'), false);
      if (options.slowRefresh) {
        await new Promise((resolve) => setTimeout(resolve, options.slowRefresh));
      }
      json(response, 200, issue());
    } else {
      response.writeHead(404).end();
    }
  });
  const gate = createServer(async (request, response) => {
    const url = new URL(request.url, resource);
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(response, 200, { resource, authorization_servers: [issuer] });
      return;
    }
    const text = await body(request);
    const message = text ? JSON.parse(text) : undefined;
    const token = (request.headers.authorization ?? '').replace('Bearer ', '');
    state.mcp.push({ method: request.method, token, message });
    if (!state.valid.has(token)) {
      response.writeHead(401, { 'content-type': 'text/plain' }).end(`rejected ${token}`);
      return;
    }
    if (state.mcpHandler?.(request, response, message)) {
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(405).end();
    } else if (message?.id === undefined) {
      response.writeHead(202).end();
    } else if (message.method === 'initialize') {
      json(
        response,
        200,
        {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            serverInfo: { name: 'hub', version: '1' },
          },
        },
        { 'mcp-session-id': 'session-1' },
      );
    } else {
      json(response, 200, { jsonrpc: '2.0', id: message.id, result: { tools: [] } });
    }
  });
  await listen(auth);
  await listen(gate);
  t.after(() => {
    for (const server of [auth, gate]) {
      server.closeAllConnections();
      server.close();
    }
  });
  issuer = `http://127.0.0.1:${auth.address().port}/`;
  resource = `http://127.0.0.1:${gate.address().port}/mcp`;

  const root = await mkdtemp(join(tmpdir(), 'rdh-bridge-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let password = null;
  const entry = {
    getPassword: async () => password,
    setPassword: async (value) => {
      password = value;
    },
  };
  const directory = join(root, 'store');
  const browser = { opened: [], mode: 'approve' };
  const instance = (extra = {}) =>
    new BridgeAuth({
      endpoint: resource,
      store: new SecureStore(directory, async () => entry),
      port: null,
      signInTimeoutMs: 300,
      openBrowser: async (link) => {
        browser.opened.push(link);
        if (browser.mode === 'approve') {
          // Follows the redirect back to the loopback callback, as a browser does.
          await fetch(link);
        } else if (browser.mode === 'forged') {
          const target = new URL(new URL(link).searchParams.get('redirect_uri'));
          target.searchParams.set('code', 'stolen');
          target.searchParams.set('state', 'not-the-state');
          await fetch(target);
        }
      },
      ...extra,
    });
  return { state, resource, issuer, directory, browser, instance };
}

test('first use registers, signs in through the browser, and stores only ciphertext', async (t) => {
  const h = await hub(t);
  const token = await h.instance().accessToken();
  assert.equal(token, 'access-1-secret');
  assert.equal(h.browser.opened.length, 1);
  const link = new URL(h.browser.opened[0]);
  assert.equal(link.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(link.searchParams.get('state'));
  assert.equal(h.state.registrations.length, 1);
  const [registration] = h.state.registrations;
  assert.equal(registration.client_name, 'Remote Device Hub for DeepSeek Harness');
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.match(registration.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
  assert.equal(new URL(registration.redirect_uris[0]).pathname, CALLBACK_PATH);

  const files = (await readdir(h.directory)).filter((name) => !name.startsWith('.'));
  assert.ok(files.some((name) => name.endsWith('_tokens.json')));
  assert.ok(files.some((name) => name.endsWith('_client.json')));
  assert.equal(
    files.some((name) => name.endsWith('_verifier.txt')),
    false,
  );
  for (const name of files) {
    const bytes = await readFile(join(h.directory, name));
    assert.equal(bytes.subarray(0, 4).toString(), 'RDH1');
    for (const secret of ['access-1-secret', 'refresh-1-secret', 'client-1']) {
      assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
  }
  // A second bridge process reuses the sign-in without contacting anything.
  const before = h.state.tokenRequests.length;
  assert.equal(await h.instance().accessToken(), 'access-1-secret');
  assert.equal(h.browser.opened.length, 1);
  assert.equal(h.state.tokenRequests.length, before);
});

test('an expiring token is refreshed once, even when several bridges notice together', async (t) => {
  const h = await hub(t, { slowRefresh: 80 });
  await h.instance().accessToken();
  // Fifty-nine minutes and forty seconds into a one-hour token.
  const later = () => Date.now() + 3_580_000;
  const tokens = await Promise.all(
    [1, 2, 3, 4].map(() => h.instance({ now: later }).accessToken()),
  );
  assert.deepEqual(new Set(tokens), new Set(['access-2-secret']));
  const refreshes = h.state.tokenRequests.filter((r) => r.grant_type === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].refresh_token, 'refresh-1-secret');
  assert.equal(h.browser.opened.length, 1);
});

test('a rejected token is renewed and the same request is sent again', async (t) => {
  const h = await hub(t);
  const auth = h.instance();
  const call = authorizedFetch(auth);
  assert.equal(
    (
      await call(h.resource, {
        method: 'POST',
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      })
    ).status,
    200,
  );
  h.state.valid.delete('access-1-secret');
  const response = await call(h.resource, {
    method: 'POST',
    body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    h.state.mcp.filter((entry) => entry.message?.id === 2).map((entry) => entry.token),
    ['access-1-secret', 'access-2-secret'],
  );
  // Another bridge that still holds the old token picks up the stored one.
  assert.equal(await h.instance().accessToken('access-1-secret'), 'access-2-secret');
  assert.equal(h.state.tokenRequests.filter((r) => r.grant_type === 'refresh_token').length, 1);
});

test('an unreachable sign-in service keeps the saved sign-in and opens no browser', async (t) => {
  const h = await hub(t, { lifetime: 30 });
  await h.instance().accessToken();
  h.state.failRefresh = 'network';
  await assert.rejects(h.instance().accessToken(), AuthUnavailableError);
  assert.equal(h.browser.opened.length, 1);
  h.state.failRefresh = undefined;
  assert.equal(await h.instance().accessToken(), 'access-2-secret');
  assert.equal(h.browser.opened.length, 1);
});

test('a refresh token the server no longer accepts leads to one new sign-in', async (t) => {
  const h = await hub(t, { lifetime: 30 });
  await h.instance().accessToken();
  h.state.refresh.set('refresh-1-secret', false);
  assert.equal(await h.instance().accessToken(), 'access-2-secret');
  assert.equal(h.browser.opened.length, 2);
  // The client registration is kept across the new sign-in when the address matches.
  assert.ok(h.state.registrations.length <= 2);
});

test('a callback with the wrong state is ignored and the sign-in times out', async (t) => {
  const h = await hub(t);
  h.browser.mode = 'forged';
  await assert.rejects(h.instance().accessToken(), SignInError);
  assert.equal(h.state.tokenRequests.length, 0);
  h.browser.mode = 'ignore';
  await assert.rejects(h.instance().accessToken(), /timed out/);
  h.browser.mode = 'approve';
  assert.equal(await h.instance().accessToken(), 'access-1-secret');
});

test('a busy preferred port falls back to another one and registers that address', async (t) => {
  const h = await hub(t);
  const blocker = createServer();
  await listen(blocker);
  t.after(() => blocker.close());
  await h.instance({ port: blocker.address().port }).accessToken();
  const [uri] = h.state.registrations[0].redirect_uris;
  assert.notEqual(new URL(uri).port, String(blocker.address().port));
});

test('the lock runs one holder at a time and recovers from a dead owner', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rdh-lock-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let active = 0;
  let peak = 0;
  await Promise.all(
    [1, 2, 3, 4, 5].map(() =>
      withLock(root, '.auth-lock', async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }),
    ),
  );
  assert.equal(peak, 1);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(root, '.auth-lock'));
  await writeFile(join(root, '.auth-lock', 'owner'), '2147483646');
  assert.equal(await withLock(root, '.auth-lock', async () => 'ran', { waitMs: 2000 }), 'ran');
});

function client(t, h, auth = h.instance()) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const exit = runBridge({ endpoint: h.resource, auth, stdin, stdout });
  const waiting = new Map();
  let buffer = '';
  stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) {
        break;
      }
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  t.after(() => stdin.end());
  const send = (message) => stdin.write(`${JSON.stringify(message)}\n`);
  const request = (id, method) => {
    const reply = new Promise((resolve) => waiting.set(id, resolve));
    send({
      jsonrpc: '2.0',
      id,
      method,
      params:
        method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'dsh', version: '1' },
            }
          : {},
    });
    return reply;
  };
  return { stdin, exit, send, request };
}

test('the bridge signs in on first use and carries JSON and SSE replies in both directions', async (t) => {
  const h = await hub(t);
  h.state.mcpHandler = (request, response, message) => {
    if (message?.method === 'tools/call') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ran' }] } })}\n\n`,
      );
      return true;
    }
  };
  const c = client(t, h);
  assert.equal((await c.request(1, 'initialize')).result.serverInfo.name, 'hub');
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual((await c.request(2, 'tools/list')).result.tools, []);
  assert.equal((await c.request(3, 'tools/call')).result.content[0].text, 'ran');
  assert.equal(h.browser.opened.length, 1);
  assert.ok(h.state.mcp.every((entry) => entry.token === 'access-1-secret'));
  c.stdin.end();
  assert.equal(await c.exit, 0);
});

test('a failed request is answered as an error without upstream text, and the next one works', async (t) => {
  const h = await hub(t);
  let failures = 1;
  h.state.mcpHandler = (request, response, message) => {
    if (message?.method === 'tools/list' && failures > 0) {
      failures -= 1;
      response
        .writeHead(503, { 'content-type': 'text/plain' })
        .end('upstream-detail access-1-secret');
      return true;
    }
  };
  const c = client(t, h);
  await c.request(1, 'initialize');
  const failed = await c.request(2, 'tools/list');
  assert.equal(failed.error.code, -32000);
  assert.match(failed.error.message, /HTTP 503/);
  assert.equal(JSON.stringify(failed).includes('upstream-detail'), false);
  assert.equal(JSON.stringify(failed).includes('access-1-secret'), false);
  assert.deepEqual((await c.request(3, 'tools/list')).result.tools, []);
});

test('a lost remote session ends the bridge so the client reconnects', async (t) => {
  const h = await hub(t);
  const c = client(t, h);
  await c.request(1, 'initialize');
  h.state.mcpHandler = (request, response) => {
    response.writeHead(404).end();
    return true;
  };
  c.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(await c.exit, 1);
});

test('failure text never includes the underlying error', () => {
  const secret = 'refresh-9-secret';
  for (const error of [
    new Error(secret),
    { code: 500, message: secret },
    secret,
    new SignInError('Sign-in timed out.'),
  ]) {
    assert.equal(describeFailure(error).includes(secret), false);
  }
});
