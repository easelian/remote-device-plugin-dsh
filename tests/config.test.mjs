import { readdirSync, readFileSync } from 'node:fs';
import { PUBLIC_URL, MCP_PUBLIC_URL } from '../bin/deployment-defaults.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ENDPOINT,
  DEFAULT_OAUTH_PORT,
  PUBLIC_ORIGIN,
  resolveConfig,
} from '../bin/config.mjs';

test('generated deployment supplies the public defaults and direct transport is disabled', () => {
  assert.equal(PUBLIC_ORIGIN, new URL(MCP_PUBLIC_URL).origin);
  assert.equal(DEFAULT_ENDPOINT, `${PUBLIC_ORIGIN}/mcp`);
  assert.equal(DEFAULT_OAUTH_PORT, 3335);
  assert.deepEqual(resolveConfig({}), {
    endpoint: DEFAULT_ENDPOINT,
    publicOrigin: PUBLIC_ORIGIN,
    directOrigin: '',
  });
});

test('a custom endpoint derives its own OAuth origin without an implicit direct origin', () => {
  assert.deepEqual(
    resolveConfig({ RDH_MCP_URL: ' https://HUB.example:443/custom/mcp?tenant=a ' }),
    {
      endpoint: 'https://hub.example/custom/mcp?tenant=a',
      publicOrigin: 'https://hub.example',
      directOrigin: '',
    },
  );
});

test('explicit public and direct origins are normalized', () => {
  assert.deepEqual(
    resolveConfig({
      RDH_MCP_URL: 'https://hub.example/mcp',
      RDH_PUBLIC_ORIGIN: ' https://AUTH.example:443/ ',
      RDH_DIRECT_ORIGIN: ' https://DIRECT.example:8443/ ',
    }),
    {
      endpoint: 'https://hub.example/mcp',
      publicOrigin: 'https://auth.example',
      directOrigin: 'https://direct.example:8443',
    },
  );
  for (const disabled of ['', ' ', 'off', ' OFF ']) {
    assert.equal(resolveConfig({ RDH_DIRECT_ORIGIN: disabled }).directOrigin, '');
  }
});

test('only loopback HTTP is accepted for each URL setting', () => {
  for (const key of ['RDH_MCP_URL', 'RDH_PUBLIC_ORIGIN', 'RDH_DIRECT_ORIGIN']) {
    for (const host of ['localhost:8090', '127.0.0.1:8090', '127.9.8.7', '[::1]:8090']) {
      assert.doesNotThrow(() => resolveConfig({ [key]: `http://${host}` }));
    }
    for (const value of [
      'http://hub.example',
      'http://localhost.example',
      'http://192.168.1.20',
      'ftp://hub.example',
      '//hub.example',
      'not a URL',
      'https://user:password@hub.example',
      'https://hub.example/#fragment',
      'https://hub.example/#',
    ]) {
      assert.throws(() => resolveConfig({ [key]: value }), new RegExp(key));
    }
  }
});

test('origin overrides reject paths and queries instead of silently discarding them', () => {
  for (const key of ['RDH_PUBLIC_ORIGIN', 'RDH_DIRECT_ORIGIN']) {
    for (const suffix of ['/oauth', '/?tenant=a', '/?']) {
      assert.throws(
        () => resolveConfig({ [key]: `https://hub.example${suffix}` }),
        new RegExp(key),
      );
    }
  }
  for (const key of ['RDH_MCP_URL', 'RDH_PUBLIC_ORIGIN']) {
    assert.throws(() => resolveConfig({ [key]: ' ' }), new RegExp(key));
  }
});

test('runtime sources keep deployment hosts in generated defaults only', () => {
  const source = new URL('../src/', import.meta.url);
  const forbidden = [PUBLIC_URL, MCP_PUBLIC_URL].map((url) => new URL(url).hostname);
  forbidden.push('xdistribute' + '.site');
  for (const file of readdirSync(source, { recursive: true })) {
    if (
      !/\.(?:ts|mts)$/.test(file) ||
      file.replaceAll('\\', '/') === 'bin/deployment-defaults.mts'
    ) {
      continue;
    }
    const content = readFileSync(new URL(file, source), 'utf8');
    assert.equal(
      forbidden.some((host) => content.includes(host)),
      false,
      file,
    );
  }
});
