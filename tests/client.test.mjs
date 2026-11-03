import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function harness() {
  const states = [];
  let cursor = 0;
  let component;
  const locales = [];
  const react = {
    createElement: (tag, props, ...children) => ({ tag, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) {
        states[index] = initial;
      }
      return [
        states[index],
        (value) => {
          states[index] = value;
        },
      ];
    },
  };
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(module) {
          assert.equal(module.id, 'dsh-remote-device-hub');
          const plugin = module.factory((name) => {
            assert.equal(name, 'react');
            return react;
          });
          plugin.apply({
            effect: (callback) => callback(),
            locale: {
              register: (namespace, translations) => locales.push({ namespace, translations }),
            },
            slots: {
              inject: (name, callback) => {
                assert.equal(name, 'plugins.row.config');
                return callback();
              },
              register(options, render) {
                assert.equal(options.key, 'dsh-remote-device-hub#remote-device-hub');
                component = render;
              },
            },
          });
        },
      },
    },
  });
  const render = (props) => {
    cursor = 0;
    return component({ t: (key) => key, view: 'config', ...props });
  };
  return { render, states, locales };
}

function nodes(node) {
  return node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : [];
}

test('the compiled browser entry loads through the DSH loader and registers both locales', () => {
  const { render, locales } = harness();
  assert.equal(locales[0].namespace, 'remote-device-hub-settings');
  assert.match(locales[0].translations.en.title, /approval/u);
  assert.match(locales[0].translations.zh.title, /批准/u);
  assert.equal(render({ view: 'summary' }).children[0], 'summary');
  assert.equal(render({}).children[0], 'loading');
  assert.equal(render({ form: { state: { status: 'unavailable' } } }).children[0], 'unavailable');
});

test('all permission modes and the boolean fallback select the expected radio', () => {
  const { render } = harness();
  for (const mode of ['always-ask', 'read-only', 'low-risk', 'allow-all']) {
    const tree = render({
      form: { state: { status: 'ready', writable: true, value: { permissionMode: mode } } },
    });
    const selected = nodes(tree).filter((node) => node.tag === 'input' && node.props.checked);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].props.value, mode);
  }
  const tree = render({
    form: { state: { status: 'ready', writable: false, value: { confirmMutations: false } } },
  });
  const radios = nodes(tree).filter((node) => node.tag === 'input');
  assert.ok(radios.every((node) => node.props.disabled));
  assert.equal(radios.find((node) => node.props.checked).props.value, 'allow-all');
});

test('a setting update preserves the opaque revision and reports sync/async failures', async () => {
  for (const outcome of ['accepted', 'rejected', 'throw', 'async-throw']) {
    const { render, states } = harness();
    const revision = { hostRevision: 4 };
    let mutation;
    const form = {
      state: { status: 'ready', writable: true, revision, value: {} },
      mutate(operations, received) {
        mutation = operations;
        assert.equal(received, revision);
        if (outcome === 'throw') {
          throw new Error('host failed');
        }
        if (outcome === 'async-throw') {
          return Promise.reject(new Error('host failed'));
        }
        return outcome === 'accepted';
      },
    };
    const tree = render({ form });
    nodes(tree)
      .find((node) => node.tag === 'input' && node.props.value === 'low-risk')
      .props.onChange();
    assert.equal(states[0], true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(mutation)), [
      { op: 'set', path: ['permissionMode'], value: 'low-risk' },
    ]);
    assert.equal(states[0], false);
    assert.equal(states[1], outcome !== 'accepted');
  }
});
