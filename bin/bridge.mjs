import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AuthUnavailableError, SignInError } from './auth.mjs';
import { log } from './bridge-log.mjs';
import { LockTimeoutError } from './lock.mjs';
import { STORAGE_ERROR, SecureStorageError } from './secure-store.mjs';
function httpStatus(error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return typeof code === 'number' && code >= 100 && code <= 599 ? code : undefined;
}
/** What the model and the user may see. Upstream text and error objects are never passed on. */
export function describeFailure(error) {
    if (error instanceof SecureStorageError) {
        return STORAGE_ERROR;
    }
    if (error instanceof SignInError) {
        return `Remote Device Hub sign-in did not complete: ${error.message}`;
    }
    if (error instanceof AuthUnavailableError || error instanceof LockTimeoutError) {
        return 'Remote Device Hub sign-in could not be renewed right now. Try again.';
    }
    const status = httpStatus(error);
    return status === undefined
        ? 'Remote Device Hub could not be reached. Check connectivity and try again.'
        : `Remote Device Hub returned HTTP ${status}. Try again.`;
}
/** Add the access token; after a 401, renew once and send the same request again. */
export function authorizedFetch(auth, base = fetch) {
    return async (input, init) => {
        const send = (token) => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${token}`);
            // The bearer token never follows a redirect.
            return base(input, { ...init, headers, redirect: 'manual' });
        };
        let token = await auth.accessToken();
        let response = await send(token);
        if (response.status === 401) {
            // A 401 means the request was not processed, so sending it again is safe.
            void response.body?.cancel().catch(() => { });
            token = await auth.accessToken(token);
            response = await send(token);
        }
        if (response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => { });
            return new Response(null, { status: 502 });
        }
        return response;
    };
}
/**
 * Run until the client closes stdin or the remote session is lost. Resolves
 * with the process exit code.
 */
export async function runBridge(options) {
    const incoming = new StdioServerTransport(options.stdin ?? process.stdin, options.stdout ?? process.stdout);
    const outgoing = new StreamableHTTPClientTransport(new URL(options.endpoint), {
        // No SDK auth provider here: renewal is coordinated across processes in auth.mts.
        fetch: authorizedFetch(options.auth, options.fetchFn),
    });
    let finish = () => { };
    const done = new Promise((resolve) => {
        finish = resolve;
    });
    let closed = false;
    const stop = (code) => {
        if (closed) {
            return;
        }
        closed = true;
        void outgoing.close().catch(() => { });
        void incoming.close().catch(() => { });
        finish(code);
    };
    // One chain keeps client-bound messages in order.
    let downstream = Promise.resolve();
    const deliver = (message) => {
        downstream = downstream.then(() => incoming.send(message)).catch(() => stop(1));
    };
    let initializeId;
    outgoing.onmessage = (message) => {
        // Forwarding bypasses the SDK client's own protocol negotiation.
        if ('id' in message && message.id === initializeId && 'result' in message) {
            const version = message.result.protocolVersion;
            if (typeof version === 'string') {
                outgoing.setProtocolVersion(version);
            }
        }
        deliver(message);
    };
    // The SDK reports stream trouble here and reconnects by itself.
    outgoing.onerror = () => { };
    incoming.onerror = () => stop(1);
    incoming.onclose = () => stop(0);
    incoming.onmessage = (message) => {
        const id = 'method' in message && 'id' in message ? message.id : undefined;
        if (id !== undefined && 'method' in message && message.method === 'initialize') {
            initializeId = id;
        }
        outgoing.send(message).catch((error) => {
            const text = describeFailure(error);
            log(text);
            if (httpStatus(error) === 404 && outgoing.sessionId !== undefined) {
                // The Hub no longer knows this session. Exit so the client reconnects
                // and negotiates a new one.
                stop(1);
                return;
            }
            if (id !== undefined) {
                deliver({ jsonrpc: '2.0', id, error: { code: -32000, message: text } });
            }
        });
    };
    const stdin = options.stdin ?? process.stdin;
    stdin.once('end', () => stop(0));
    stdin.once('close', () => stop(0));
    await outgoing.start();
    await incoming.start();
    return done;
}
