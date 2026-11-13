import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildProxyArgs,
  isEntryPoint,
  isPortFree,
  preferredPort,
  resolveProxy,
} from '../bin/launcher.mjs';

test('preferredPort defaults to 3335', () => {
  assert.equal(preferredPort(''), 3335);
});

test('preferredPort accepts a numeric override', () => {
  assert.equal(preferredPort('4444'), 4444);
});

test('preferredPort can disable the preference', () => {
  assert.equal(preferredPort('off'), null);
  assert.equal(preferredPort('0'), null);
});

test('preferredPort rejects invalid values', () => {
  for (const value of ['abc', '65536', '-1', '1.5']) {
    assert.throws(() => preferredPort(value), /RDH_OAUTH_PORT/);
  }
});

test('buildProxyArgs passes the endpoint, port, and transport', () => {
  const args = buildProxyArgs({
    proxyPath: '/tmp/proxy.js',
    url: 'https://example.test/mcp',
    port: 3335,
  });
  assert.deepEqual(args, [
    '/tmp/proxy.js',
    'https://example.test/mcp',
    '3335',
    '--transport',
    'http-only',
    '--static-oauth-client-metadata',
    JSON.stringify({ client_name: 'Remote Device Hub for DeepSeek Harness' }),
  ]);
});

test('buildProxyArgs omits the positional port when disabled', () => {
  const args = buildProxyArgs({
    proxyPath: '/tmp/proxy.js',
    url: 'https://example.test/mcp',
    port: null,
  });
  assert.deepEqual(args, [
    '/tmp/proxy.js',
    'https://example.test/mcp',
    '--transport',
    'http-only',
    '--static-oauth-client-metadata',
    JSON.stringify({ client_name: 'Remote Device Hub for DeepSeek Harness' }),
  ]);
});

test('loopback HTTP is allowed explicitly, while remote HTTP cannot reach the proxy', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = `http://${host}:8080/mcp`;
    assert.deepEqual(buildProxyArgs({ proxyPath: '/tmp/proxy.js', url, port: null }), [
      '/tmp/proxy.js',
      url,
      '--transport',
      'http-only',
      '--static-oauth-client-metadata',
      JSON.stringify({ client_name: 'Remote Device Hub for DeepSeek Harness' }),
      '--allow-http',
    ]);
  }
  assert.throws(
    () => buildProxyArgs({ proxyPath: '/tmp/proxy.js', url: 'http://hub.example/mcp' }),
    /RDH_MCP_URL/,
  );
});

test('resolveProxy points only at the secure private bridge', () => {
  assert.match(resolveProxy(), /bin[\\/]bridge[\\/]proxy\.js$/u);
});

test('isEntryPoint recognizes a symlinked profile installation', async () => {
  const launcher = fileURLToPath(new URL('../bin/launcher.mjs', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'rdh-launcher-'));
  const link = join(directory, 'launcher.mjs');
  try {
    await symlink(launcher, link);
    assert.equal(isEntryPoint(link, pathToFileURL(launcher).href), true);
    assert.equal(isEntryPoint(launcher, pathToFileURL(launcher).href), true);
    assert.equal(isEntryPoint(join(directory, 'other.mjs'), pathToFileURL(launcher).href), false);
    assert.equal(isEntryPoint(undefined, pathToFileURL(launcher).href), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('isPortFree sees an available port and a bound port', async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await new Promise((resolve) => probe.close(resolve));
  }
  assert.equal(await isPortFree(port), true);
});

test('the private bridge rejects unsupported auth modes before storage or network access', () => {
  for (const option of ['--device-code', '--client-credentials', '--header-file']) {
    const result = spawnSync(
      process.execPath,
      [resolveProxy(), 'https://must-not-connect.invalid/mcp', option],
      {
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported private bridge option/);
    assert.equal(result.stdout, '');
  }
});
