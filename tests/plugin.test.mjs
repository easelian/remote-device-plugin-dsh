import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOW_RISK_TOOLS,
  READ_ONLY_TOOLS,
  apply,
  mutationDecision,
  resolvePermissionMode,
} from '../index.js';

function createHarness({
  approval = {},
  confirmMutations = true,
  skills = true,
  serverName,
  permissionMode,
} = {}) {
  const listeners = new Map();
  const providers = [];
  const ctx = {
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    get(name) {
      return name === 'approval' ? approval : undefined;
    },
    inject(services, callback) {
      assert.deepEqual(services, ['skills']);
      callback({
        skills: skills ? { registerProvider: (factory) => providers.push(factory()) } : undefined,
      });
      return () => {};
    },
  };
  const config = { confirmMutations };
  if (serverName !== undefined) {
    config.serverName = serverName;
  }
  if (permissionMode !== undefined) {
    config.permissionMode = permissionMode;
  }
  apply(ctx, config);
  return {
    listeners,
    providers,
    gate: listeners.get('tools/pre-execute'),
  };
}

const next = async () => 'next';

test('registers one bundled skill provider', async () => {
  const { providers } = createHarness();
  assert.equal(providers.length, 1);
  const provider = providers[0];
  assert.equal(provider.name, 'dsh-remote-device-hub');
  const [candidate] = await provider.list();
  assert.equal(candidate.name, 'remote-device-hub');
  assert.equal(candidate.invocation.modelInvocable, true);
  assert.match(candidate.description, /Remote Device Hub/u);

  const definition = await provider.get(candidate);
  assert.equal(definition.name, 'remote-device-hub');
  assert.match(definition.content, /^# Remote Device Hub/mu);
  assert.doesNotMatch(definition.content, /^---/u);
  assert.equal(definition.resourceBase.kind, 'directory');
});

test('the skill is skipped when the profile has no skill registry', () => {
  const { providers } = createHarness({ skills: false });
  assert.equal(providers.length, 0);
});

test('read-only tools pass through the approval gate', async () => {
  const { gate } = createHarness();
  assert.ok(gate);
  for (const tool of [
    'list_devices',
    'read_file',
    'list_processes',
    'get_call_status',
    'list_calls',
    'get_operation_status',
    'list_operations',
  ]) {
    const decision = await gate({ name: `mcp__remote-device-hub__${tool}`, args: {} }, next);
    assert.equal(decision, 'next');
  }
});

test('preparing an operation remains subject to approval', async () => {
  const { gate } = createHarness({ permissionMode: 'read-only' });
  const decision = await gate(
    { name: 'mcp__remote-device-hub__prepare_operation', args: { device_id: 'device' } },
    next,
  );
  assert.equal(decision.kind, 'ask');
});

test('device mutations ask for approval', async () => {
  const { gate } = createHarness();
  const decision = await gate(
    {
      name: 'mcp__remote-device-hub__write_file',
      args: { device_id: 'kylin-a570' },
    },
    next,
  );
  assert.equal(decision.kind, 'ask');
  assert.match(decision.reason, /write_file/u);
  assert.match(decision.reason, /kylin-a570/u);
  assert.match(decision.displayReason.en, /write_file/u);
  assert.match(decision.displayReason.zh, /kylin-a570/u);
});

test('tools from another MCP server are ignored', async () => {
  const { gate } = createHarness();
  const decision = await gate(
    {
      name: 'mcp__other__write_file',
      args: { device_id: 'kylin-a570' },
    },
    next,
  );
  assert.equal(decision, 'next');
});

test('a custom server name changes the matched prefix', async () => {
  const { gate } = createHarness({ serverName: 'rdh' });
  const matching = await gate({ name: 'mcp__rdh__start_process', args: {} }, next);
  assert.equal(matching.kind, 'ask');
  const old = await gate({ name: 'mcp__remote-device-hub__start_process', args: {} }, next);
  assert.equal(old, 'next');
});

test('the gate steps aside without an approval channel', async () => {
  const { gate } = createHarness({ approval: null });
  const decision = await gate(
    {
      name: 'mcp__remote-device-hub__terminate_process',
      args: {},
    },
    next,
  );
  assert.equal(decision, 'next');
});

test('confirmMutations false falls back to allow-all', async () => {
  const { gate } = createHarness({ confirmMutations: false });
  assert.ok(gate);
  assert.equal(
    await gate({ name: 'mcp__remote-device-hub__start_process', args: {} }, next),
    'next',
  );
});

test('mutationDecision exposes the read-only set', () => {
  assert.ok(READ_ONLY_TOOLS.has('read_file'));
  assert.ok(!READ_ONLY_TOOLS.has('write_file'));
});

test('always-ask asks even for read-only tools', async () => {
  const { gate } = createHarness({ permissionMode: 'always-ask' });
  const decision = await gate({ name: 'mcp__remote-device-hub__read_file', args: {} }, next);
  assert.equal(decision.kind, 'ask');
});

test('read-only passes reads and asks for any change', async () => {
  const { gate } = createHarness({ permissionMode: 'read-only' });
  assert.equal(await gate({ name: 'mcp__remote-device-hub__read_file', args: {} }, next), 'next');
  assert.equal(
    (await gate({ name: 'mcp__remote-device-hub__make_directory', args: {} }, next)).kind,
    'ask',
  );
  assert.equal(
    (
      await gate(
        { name: 'mcp__remote-device-hub__write_file', args: { expected_sha256: '' } },
        next,
      )
    ).kind,
    'ask',
  );
});

test('low-risk allows create-only writes but asks for overwrites', async () => {
  const { gate } = createHarness({ permissionMode: 'low-risk' });
  for (const tool of ['read_file', 'make_directory', 'stop_search']) {
    assert.equal(await gate({ name: `mcp__remote-device-hub__${tool}`, args: {} }, next), 'next');
  }
  assert.equal(
    await gate(
      {
        name: 'mcp__remote-device-hub__write_file',
        args: { expected_sha256: '' },
      },
      next,
    ),
    'next',
  );
  assert.equal(
    (
      await gate(
        {
          name: 'mcp__remote-device-hub__write_file',
          args: { expected_sha256: 'a'.repeat(64) },
        },
        next,
      )
    ).kind,
    'ask',
  );
  for (const tool of ['start_process', 'terminate_process']) {
    assert.equal(
      (await gate({ name: `mcp__remote-device-hub__${tool}`, args: {} }, next)).kind,
      'ask',
    );
  }
  assert.ok(LOW_RISK_TOOLS.has('make_directory'));
  assert.ok(!LOW_RISK_TOOLS.has('write_file'));
});

test('allow-all accepts every tool', async () => {
  const { gate } = createHarness({ permissionMode: 'allow-all' });
  assert.ok(gate);
  assert.equal(
    await gate({ name: 'mcp__remote-device-hub__start_process', args: {} }, next),
    'next',
  );
  assert.equal(
    mutationDecision(
      { name: 'mcp__remote-device-hub__start_process', args: {} },
      {
        permissionMode: 'allow-all',
        approvalAvailable: true,
      },
    ),
    null,
  );
});

test('confirmMutations supplies the fallback permission mode', () => {
  assert.equal(resolvePermissionMode({}), 'read-only');
  assert.equal(resolvePermissionMode({ confirmMutations: false }), 'allow-all');
  assert.equal(resolvePermissionMode({ confirmMutations: true }), 'read-only');
  assert.equal(
    resolvePermissionMode({ permissionMode: 'low-risk', confirmMutations: false }),
    'low-risk',
  );
});

test('volatile config observables are read through get()', () => {
  const observable = (value) => ({ get: () => value });
  assert.equal(resolvePermissionMode({ permissionMode: observable('allow-all') }), 'allow-all');
  assert.equal(resolvePermissionMode({ confirmMutations: observable(false) }), 'allow-all');
  assert.equal(
    resolvePermissionMode({
      permissionMode: observable('low-risk'),
      confirmMutations: observable(false),
    }),
    'low-risk',
  );
});
