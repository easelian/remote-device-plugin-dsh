import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SecureStore, STORAGE_ERROR } from '../bin/secure-store.mjs';
import { authorizationNotice } from '../bin/bridge-log.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rdh-secure-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let password = null;
  const entry = {
    async getPassword() {
      return password;
    },
    async setPassword(value) {
      password = value;
    },
  };
  const directory = join(root, 'store');
  return { root, directory, entry, store: new SecureStore(directory, async () => entry) };
}

test('all OAuth records are encrypted, private, authenticated, and readable after restart', async (t) => {
  const { store, directory, entry } = await fixture(t);
  const secret = 'private-access-refresh-client-and-verifier';
  for (const name of [
    'tokens.json',
    'client_info.json',
    'code_verifier.txt',
    'discovery_state.json',
  ]) {
    await store.write('endpoint', name, secret);
    const path = join(directory, `endpoint_${name}`);
    const bytes = await readFile(path);
    assert.equal(bytes.includes(Buffer.from(secret)), false);
    assert.equal(bytes.subarray(0, 4).toString(), 'RDH1');
    assert.equal(
      await new SecureStore(directory, async () => entry).read('endpoint', name),
      secret,
    );
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
  }
  if (process.platform !== 'win32') {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  }
  const bytes = await readFile(join(directory, 'endpoint_tokens.json'));
  await writeFile(join(directory, 'other_tokens.json'), bytes);
  await assert.rejects(store.read('other', 'tokens.json'), { message: STORAGE_ERROR });
  bytes[bytes.length - 1] ^= 1;
  await writeFile(join(directory, 'endpoint_tokens.json'), bytes);
  await assert.rejects(store.read('endpoint', 'tokens.json'), { message: STORAGE_ERROR });
});

test('unavailable keyring never creates plaintext records or exposes backend errors', async (t) => {
  const { directory } = await fixture(t);
  const store = new SecureStore(directory, async () => {
    throw new Error('backend-secret-value');
  });
  await assert.rejects(store.write('endpoint', 'tokens.json', 'token'), { message: STORAGE_ERROR });
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(store.read('endpoint', 'tokens.json'), { message: STORAGE_ERROR });
});

test('missing key over existing ciphertext fails without replacing the key', async (t) => {
  const { store, directory } = await fixture(t);
  await store.write('endpoint', 'tokens.json', 'secret');
  let writes = 0;
  const restarted = new SecureStore(directory, async () => ({
    async getPassword() {
      return null;
    },
    async setPassword() {
      writes++;
    },
  }));
  await assert.rejects(restarted.read('endpoint', 'tokens.json'), { message: STORAGE_ERROR });
  assert.equal(writes, 0);
});

test('plaintext and symlink records are rejected; no alternate file is read', async (t) => {
  const { store, directory, root } = await fixture(t);
  await store.ready();
  await writeFile(join(directory, 'endpoint_tokens.json'), '{"access_token":"legacy"}');
  await assert.rejects(store.read('endpoint', 'tokens.json'), { message: STORAGE_ERROR });
  if (process.platform !== 'win32') {
    await writeFile(join(root, 'other'), 'private');
    await symlink(join(root, 'other'), join(directory, 'endpoint_client_info.json'));
    await assert.rejects(store.read('endpoint', 'client_info.json'), { message: STORAGE_ERROR });
  }
});

test('concurrent initialization shares one durable key and deletion persists', async (t) => {
  const { store, directory, entry } = await fixture(t);
  const other = new SecureStore(directory, async () => entry);
  await Promise.all([store.ready(), other.ready()]);
  await store.write('endpoint', 'tokens.json', 'secret');
  assert.equal(await other.read('endpoint', 'tokens.json'), 'secret');
  await other.remove('endpoint', 'tokens.json');
  assert.equal(await store.read('endpoint', 'tokens.json'), undefined);
});

test('the sign-in link is printed only when it is a plain authorization request', () => {
  const token = 'sensitive-auth-value';
  const url =
    'https://auth.example/authorize?response_type=code&client_id=public&state=state&code_challenge=challenge';
  assert.ok(authorizationNotice(new URL(url)).includes(url));
  for (const unsafe of [
    `${url}&access_token=${token}`,
    `${url}#${token}`,
    url.replace('https://', `https://user:${token}@`),
    url.replace('https://', 'http://'),
    url.replace('response_type=code', 'response_type=token'),
  ]) {
    const notice = authorizationNotice(new URL(unsafe));
    assert.equal(notice.includes(token), false);
    assert.equal(notice.includes('auth.example'), false);
  }
  assert.ok(
    authorizationNotice(new URL(url.replace('https://', 'http://')), true).includes('http://'),
  );
});
