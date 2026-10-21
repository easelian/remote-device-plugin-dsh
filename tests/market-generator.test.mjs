import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/market-index.mjs', import.meta.url));
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });

test('market generation preserves old versions and the current publish timestamp', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'rdh-dsh-market-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, 'market.json');
  const original = JSON.parse(
    await readFile(new URL('../market/index.json', import.meta.url), 'utf8'),
  );
  const current = original.plugins[0].versions[0];
  const timestamp = current.publishTimestamp;
  original.plugins[0].versions.push({ ...current, version: '0.0.1', publishTimestamp: 1 });
  await writeFile(path, JSON.stringify(original));
  run(['--out', path, '--published-at', '2000000000']);
  const generated = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(generated.plugins[0].versions[0].publishTimestamp, timestamp);
  assert.equal(generated.plugins[0].versions.at(-1).version, '0.0.1');
  run(['--source', 'git', '--commit', 'a'.repeat(40), '--out', path, '--no-preserve']);
  const git = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(git.plugins[0].versions.length, 1);
  assert.equal(git.plugins[0].versions[0].source.type, 'git');
  assert.equal(git.plugins[0].versions[0].source.commit, 'a'.repeat(40));
});

test('invalid market inputs fail before replacing an existing output', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'rdh-dsh-market-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, 'market.json');
  const invalid = '{"format":1,"plugins":[]}';
  await writeFile(path, invalid);
  assert.throws(() => run(['--out', path]), /Cannot read existing market index/u);
  assert.equal(await readFile(path, 'utf8'), invalid);
  assert.throws(() => run(['--source', 'git', '--commit', 'not-a-sha', '--out', path]), /40-hex/u);
  assert.equal(await readFile(path, 'utf8'), invalid);
});
