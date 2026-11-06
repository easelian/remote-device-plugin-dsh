import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

test('the installed OAuth bridge discovers an independent Auth service', async (t) => {
  const proxy = require.resolve('mcp-remote/dist/proxy.js');
  const source = await readFile(proxy, 'utf8');
  const match =
    /import\s*\{[^}]*\bdiscoverOAuthServerInfo\b[^}]*\}\s*from\s*["']([^"']+)["']/su.exec(source);
  assert.ok(match, 'mcp-remote must expose the discovery helper used by its proxy');
  const { discoverOAuthServerInfo } = await import(
    pathToFileURL(resolve(dirname(proxy), match[1])).href
  );

  const requests = [];
  let resource;
  let issuer;
  const auth = createServer((req, res) => {
    requests.push(['auth', req.method, req.url]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        registration_endpoint: `${issuer}register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      }),
    );
  });
  const gate = createServer((req, res) => {
    requests.push(['gate', req.method, req.url]);
    if (req.url === '/.well-known/oauth-protected-resource/mcp') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          resource,
          authorization_servers: [issuer],
          scopes_supported: ['devices:control'],
        }),
      );
      return;
    }
    res.writeHead(401, {
      'www-authenticate': `Bearer resource_metadata="${resource.replace('/mcp', '/.well-known/oauth-protected-resource/mcp')}"`,
    });
    res.end();
  });
  const listen = (server) =>
    new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  await listen(auth);
  await listen(gate);
  t.after(() =>
    Promise.all([auth, gate].map((server) => new Promise((done) => server.close(done)))),
  );
  issuer = `http://127.0.0.1:${auth.address().port}/`;
  resource = `http://127.0.0.1:${gate.address().port}/mcp`;

  const result = await discoverOAuthServerInfo(resource);
  assert.equal(result.authorizationServerUrl, issuer);
  assert.equal(result.authorizationServerMetadata.registration_endpoint, `${issuer}register`);
  assert.equal(result.authorizationServerMetadata.token_endpoint, `${issuer}token`);
  assert.ok(requests.every(([, method]) => method === 'GET'));
  assert.ok(
    requests.some(
      ([host, , path]) => host === 'auth' && path === '/.well-known/oauth-authorization-server',
    ),
  );
});
