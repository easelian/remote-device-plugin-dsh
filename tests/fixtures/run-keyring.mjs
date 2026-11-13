import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'linux') {
  throw new Error('This fixture needs Linux, dbus-run-session, and gnome-keyring-daemon.');
}
const root = await mkdtemp(join(tmpdir(), 'rdh-native-keyring-'));
try {
  await mkdir(join(root, 'run'), { mode: 0o700 });
  const env = {
    ...process.env,
    MCP_REMOTE_CONFIG_DIR: join(root, 'auth'),
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_RUNTIME_DIR: join(root, 'run'),
  };
  const result = spawnSync(
    'dbus-run-session',
    [
      '--',
      'sh',
      '-c',
      'gnome-keyring-daemon --unlock --components=secrets <<EOF\nfixture-password\nEOF\n"$RDH_TEST_NODE" tests/fixtures/bridge-security.mjs',
    ],
    { env: { ...env, RDH_TEST_NODE: process.execPath }, encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  process.stdout.write(result.stdout);
  const unavailable = spawnSync(
    process.execPath,
    ['bin/bridge/proxy.js', 'https://must-not-connect.invalid/mcp'],
    {
      env: {
        ...env,
        MCP_REMOTE_CONFIG_DIR: join(root, 'unavailable'),
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/rdh-test-bus',
      },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(unavailable.error, undefined);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /No plaintext fallback is allowed/);
  assert.equal(unavailable.stdout, '');
  console.log('PASS: native keyring failure stops the packaged proxy before connecting');
} finally {
  await rm(root, { recursive: true, force: true });
}
