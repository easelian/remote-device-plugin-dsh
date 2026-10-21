import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DIRECT_ORIGIN,
  DEFAULT_ENDPOINT,
  DEFAULT_OAUTH_PORT,
  DIRECT_HOST,
  DIRECT_PORT,
  PUBLIC_ORIGIN,
} from '../bin/config.mjs';

test('the direct origin is built from the configurable host and port', () => {
  assert.equal(DIRECT_PORT, 8090);
  assert.equal(DIRECT_HOST, 'https://xdistribute.site');
  assert.equal(DEFAULT_DIRECT_ORIGIN, `${DIRECT_HOST}:${DIRECT_PORT}`);
});

test('the public endpoint and callback port keep their defaults', () => {
  assert.equal(DEFAULT_ENDPOINT, `${PUBLIC_ORIGIN}/mcp`);
  assert.equal(DEFAULT_OAUTH_PORT, 3335);
});
