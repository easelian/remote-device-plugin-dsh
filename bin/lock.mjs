/** A cross-process lock: one sign-in or token renewal at a time per credential directory. */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
export class LockTimeoutError extends Error {
}
function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        // EPERM means the process exists under another user.
        return error !== null && typeof error === 'object' && 'code' in error && error.code === 'EPERM';
    }
}
async function stale(lock, maxAgeMs) {
    try {
        const owner = Number((await readFile(join(lock, 'owner'), 'utf8')).trim());
        if (Number.isInteger(owner) && owner > 0 && !alive(owner)) {
            return true;
        }
        return Date.now() - (await stat(lock)).mtimeMs > maxAgeMs;
    }
    catch {
        // Created but not yet stamped, or already released: let the next poll decide.
        try {
            return Date.now() - (await stat(lock)).mtimeMs > 5_000;
        }
        catch {
            return false;
        }
    }
}
/**
 * Run `action` while holding `<directory>/<name>`. A lock whose owner has
 * exited, or that outlived `maxAgeMs`, is taken over.
 */
export async function withLock(directory, name, action, { waitMs = 6 * 60_000, maxAgeMs = 10 * 60_000, pollMs = 100 } = {}) {
    const lock = join(directory, name);
    const deadline = Date.now() + waitMs;
    for (;;) {
        try {
            await mkdir(lock, { mode: 0o700 });
            break;
        }
        catch (error) {
            const exists = error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST';
            if (!exists) {
                throw error;
            }
            if (await stale(lock, maxAgeMs)) {
                await rm(lock, { recursive: true, force: true });
                continue;
            }
            if (Date.now() >= deadline) {
                throw new LockTimeoutError();
            }
            await delay(pollMs);
        }
    }
    try {
        await writeFile(join(lock, 'owner'), String(process.pid), { mode: 0o600 });
        return await action();
    }
    finally {
        await rm(lock, { recursive: true, force: true });
    }
}
