/** Encrypted OAuth records. The OS keyring owns the key; there is no file fallback. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export interface KeyEntry {
  getPassword(signal?: AbortSignal): Promise<string | null>;
  setPassword(value: string, signal?: AbortSignal): Promise<void>;
}
export const STORAGE_ERROR =
  'Secure credential storage is unavailable or damaged. Unlock the system keyring and restart RDH. No plaintext fallback is allowed.';
export class SecureStorageError extends Error {
  constructor() {
    super(STORAGE_ERROR);
    this.name = 'SecureStorageError';
  }
}

export function credentialDirectory(env: NodeJS.ProcessEnv = process.env): string {
  // A separate namespace deliberately never reads the old plaintext bridge cache.
  return resolve(env.MCP_REMOTE_CONFIG_DIR || join(homedir(), '.mcp-auth'), 'rdh-secure-v1');
}

async function systemEntry(account: string): Promise<KeyEntry> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  // Require persistent Secret Service on Linux rather than switching to keyutils.
  return new AsyncEntry('Easelian RDH DSH', account, { linux: { store: 'secret-service' } });
}

export class SecureStore {
  private initialization: Promise<Buffer> | undefined;
  constructor(
    readonly directory = credentialDirectory(),
    private readonly entryFactory: (account: string) => Promise<KeyEntry> = systemEntry,
  ) {}

  async ready(): Promise<void> {
    await this.key();
  }

  private key(): Promise<Buffer> {
    // Pin both the backend and its key for this process. Failures do not switch stores.
    this.initialization ??= this.initialize().catch(() => {
      throw new SecureStorageError();
    });
    return this.initialization;
  }

  private async initialize(): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new SecureStorageError();
    }
    await chmod(this.directory, 0o700);
    const canonical = await realpath(this.directory);
    const account = createHash('sha256').update(canonical).digest('hex');
    const entry = await this.entryFactory(account);
    const lock = join(this.directory, '.key-init-lock');
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        await mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (!isMissingOrExists(error, 'EEXIST') || Date.now() >= deadline) {
          throw new SecureStorageError();
        }
        await delay(50);
      }
    }
    try {
      let value = await entry.getPassword(AbortSignal.timeout(10_000));
      if (value === null) {
        // Never replace a lost encryption key over existing credential records.
        if ((await readdir(this.directory)).some((name) => name !== '.key-init-lock')) {
          throw new SecureStorageError();
        }
        value = randomBytes(32).toString('base64');
        await entry.setPassword(value, AbortSignal.timeout(10_000));
        if ((await entry.getPassword(AbortSignal.timeout(10_000))) !== value) {
          throw new SecureStorageError();
        }
      }
      if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
        throw new SecureStorageError();
      }
      return Buffer.from(value, 'base64');
    } finally {
      await rm(lock, { recursive: true });
    }
  }

  private path(server: string, name: string): string {
    if (!/^[a-zA-Z0-9_-]+$/u.test(server) || !/^[a-zA-Z0-9_.-]+$/u.test(name)) {
      throw new SecureStorageError();
    }
    return join(this.directory, `${server}_${name}`);
  }

  async read(server: string, name: string): Promise<string | undefined> {
    const key = await this.key();
    try {
      const file = await open(this.path(server, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: Buffer;
      try {
        if (!(await file.stat()).isFile()) {
          throw new SecureStorageError();
        }
        content = await file.readFile();
      } finally {
        await file.close();
      }
      // Upstream writes this coordination lease directly. It contains no credential.
      if (name === 'refresh_in_progress.json') {
        const lease = JSON.parse(content.toString('utf8'));
        if (
          !Number.isInteger(lease.pid) ||
          typeof lease.nonce !== 'string' ||
          !Number.isFinite(lease.at)
        ) {
          throw new SecureStorageError();
        }
        return JSON.stringify({ pid: lease.pid, nonce: lease.nonce, at: lease.at });
      }
      if (content.length < 32 || content.subarray(0, 4).toString() !== 'RDH1') {
        throw new SecureStorageError();
      }
      const cipher = createDecipheriv('aes-256-gcm', key, content.subarray(4, 16));
      cipher.setAAD(Buffer.from(`${server}/${name}`));
      cipher.setAuthTag(content.subarray(16, 32));
      return Buffer.concat([cipher.update(content.subarray(32)), cipher.final()]).toString('utf8');
    } catch (error) {
      if (isMissingOrExists(error, 'ENOENT')) {
        return undefined;
      }
      throw new SecureStorageError();
    }
  }

  async write(server: string, name: string, value: string): Promise<void> {
    const key = await this.key();
    const target = this.path(server, name);
    const temp = `${target}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(`${server}/${name}`));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const content = Buffer.concat([Buffer.from('RDH1'), nonce, cipher.getAuthTag(), encrypted]);
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(content);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
    } catch {
      throw new SecureStorageError();
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  async remove(server: string, name: string): Promise<void> {
    await this.key();
    try {
      await rm(this.path(server, name), { force: true });
    } catch {
      throw new SecureStorageError();
    }
  }
}

function isMissingOrExists(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}

export const secureStore = new SecureStore();
