type SettingsProps = import('./client-host.js').SettingsProps;
type PermissionMode = import('./permissions.js').PermissionMode;

window.__ModuleLoader__.load({
  id: 'dsh-remote-device-hub',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'remote-device-hub-settings';

    const en = {
      summary: 'Remote Device Hub tool permissions',
      title: 'When should device tools ask for approval?',
      alwaysAsk: 'Always ask',
      alwaysAskHint: 'Ask before reading and before making any change.',
      readOnly: 'Allow read-only tools',
      readOnlyHint: 'Read without asking; ask before creating or changing anything.',
      lowRisk: 'Allow low-risk tools',
      lowRiskHint:
        'Allow reads, creating new files or directories, and stopping searches; overwrites, moves, shell commands, and process control still ask.',
      allowAll: 'Allow all tools',
      allowAllHint: 'Use tools without asking. This comes with elevated risk.',
      loading: 'Loading configuration…',
      unavailable: 'Configuration is not available in this profile.',
      saveFailed: 'The change was not saved.',
    };
    const zh = {
      summary: 'Remote Device Hub 工具权限',
      title: '设备工具何时需要批准？',
      alwaysAsk: '始终询问',
      alwaysAskHint: '读取或修改前都询问。',
      readOnly: '仅放行只读工具',
      readOnlyHint: '读取不询问，创建或修改前询问。',
      lowRisk: '放行低风险工具',
      lowRiskHint:
        '自动放行读取、创建新文件或目录、停止搜索；覆盖写入、移动、shell 命令和进程控制仍会询问。',
      allowAll: '允许全部工具',
      allowAllHint: '使用工具时不再询问。这伴随更高风险。',
      loading: '正在读取配置…',
      unavailable: '当前 profile 中没有可用的配置页面。',
      saveFailed: '修改未保存。',
    };

    const OPTIONS = {
      'always-ask': { label: 'alwaysAsk', hint: 'alwaysAskHint' },
      'read-only': { label: 'readOnly', hint: 'readOnlyHint' },
      'low-risk': { label: 'lowRisk', hint: 'lowRiskHint' },
      'allow-all': { label: 'allowAll', hint: 'allowAllHint' },
    } satisfies Record<PermissionMode, { label: keyof typeof en; hint: keyof typeof en }>;

    function isPermissionMode(value: unknown): value is PermissionMode {
      return typeof value === 'string' && Object.hasOwn(OPTIONS, value);
    }

    function currentMode(
      state: { status: string; value?: Record<string, unknown> } | undefined,
    ): PermissionMode {
      const raw = state?.value?.permissionMode;
      if (isPermissionMode(raw)) {
        return raw;
      }
      return state?.value?.confirmMutations === false ? 'allow-all' : 'read-only';
    }

    function PermissionSettings(props: SettingsProps) {
      const t = props.t;
      const form = props.form;
      const state = form?.state;
      const mode = currentMode(state);
      const writable = state?.status === 'ready' && state.writable === true;
      const [busy, setBusy] = React.useState(false);
      const [failed, setFailed] = React.useState(false);

      if (props.view === 'summary') {
        return h('span', null, t('summary'));
      }
      if (form === undefined || state === undefined || state.status === 'loading') {
        return h('p', { style: { margin: 0, opacity: 0.7 } }, t('loading'));
      }
      if (state.status !== 'ready') {
        return h('p', { style: { margin: 0, opacity: 0.7 } }, t('unavailable'));
      }

      const update = (next: PermissionMode) => {
        setBusy(true);
        setFailed(false);
        Promise.resolve()
          .then(() =>
            form.mutate([{ op: 'set', path: ['permissionMode'], value: next }], state.revision),
          )
          .then((accepted) => {
            if (!accepted) {
              setFailed(true);
            }
          })
          .catch(() => {
            setFailed(true);
          })
          .finally(() => {
            setBusy(false);
          });
      };

      return h(
        'fieldset',
        {
          style: { border: 0, margin: 0, padding: 0, display: 'grid', gap: '8px' },
        },
        h('legend', { style: { padding: 0, marginBottom: '2px', fontWeight: 600 } }, t('title')),
        ...Object.entries(OPTIONS).map(([value, option]) =>
          h(
            'label',
            {
              key: value,
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: '9px',
                cursor: writable && !busy ? 'pointer' : 'default',
              },
            },
            h('input', {
              type: 'radio',
              name: 'remote-device-hub-permission-mode',
              value,
              checked: mode === value,
              disabled: !writable || busy,
              onChange: () => {
                if (isPermissionMode(value)) {
                  update(value);
                }
              },
              style: { marginTop: '3px' },
            }),
            h(
              'span',
              { style: { display: 'grid', gap: '1px' } },
              h('span', null, t(option.label)),
              h(
                'span',
                { style: { opacity: 0.68, fontSize: '12px', lineHeight: 1.4 } },
                t(option.hint),
              ),
            ),
          ),
        ),
        failed
          ? h(
              'p',
              {
                role: 'status',
                style: { margin: 0, color: 'var(--dsw-color-danger, #c0392b)', fontSize: '12px' },
              },
              t('saveFailed'),
            )
          : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }));
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: 'dsh-remote-device-hub#remote-device-hub',
              locale: NS,
            },
            PermissionSettings,
          ),
        );
      },
    };
  },
});
