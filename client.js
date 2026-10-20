window.__ModuleLoader__.load({
  id: 'dsh-remote-device-hub',
  factory(require) {
    const React = require('react')
    const { Switch } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const NS = 'remote-device-hub-settings'

    const en = {
      label: 'Ask before device changes',
      hint: 'When enabled, Remote Device Hub asks for approval before writing files, running commands, or changing processes. The device\'s own allow_write and allow_shell settings still apply.',
      on: 'On',
      off: 'Off',
      summary: 'Device change approval',
      loading: 'Loading configuration…',
      unavailable: 'Configuration is not available in this profile.',
      saveFailed: 'The change was not saved.',
    }
    const zh = {
      label: '设备变更前请求批准',
      hint: '开启后，Remote Device Hub 在写文件、执行命令或控制进程前会请求批准。设备自身的 allow_write 和 allow_shell 限制仍然生效。',
      on: '开启',
      off: '关闭',
      summary: '设备变更审批',
      loading: '正在读取配置…',
      unavailable: '当前 profile 中没有可用的配置页面。',
      saveFailed: '修改未保存。',
    }

    function ApprovalSettings(props) {
      const t = props.t
      const form = props.form
      const state = form?.state
      const enabled = state?.value?.confirmMutations === undefined ? true : state.value.confirmMutations === true
      const writable = state?.status === 'ready' && state.writable === true
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      if (props.view === 'summary') {
        return h('span', null, t('summary'))
      }
      if (form === undefined || state === undefined || state.status === 'loading') {
        return h('p', { style: { margin: 0, opacity: 0.7 } }, t('loading'))
      }
      if (state.status === 'unavailable') {
        return h('p', { style: { margin: 0, opacity: 0.7 } }, t('unavailable'))
      }

      const update = (next) => {
        setBusy(true)
        setFailed(false)
        Promise.resolve(form.mutate(
          [{ op: 'set', path: ['confirmMutations'], value: next }],
          state.revision,
        )).then((accepted) => {
          if (!accepted) setFailed(true)
        }).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }

      return h('div', { style: { display: 'grid', gap: '6px', padding: '2px 0' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h(Switch, {
            checked: enabled,
            onChange: update,
            label: t('label'),
            disabled: !writable || busy,
          }),
          h('span', null, t('label'))),
        h('p', { style: { margin: 0, opacity: 0.7, fontSize: '12px', lineHeight: 1.45 } }, t('hint')),
        failed ? h('p', { role: 'status', style: { margin: 0, color: 'var(--dsw-color-danger, #c0392b)', fontSize: '12px' } }, t('saveFailed')) : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-remote-device-hub#remote-device-hub',
          locale: NS,
        }, ApprovalSettings))
      },
    }
  },
})
