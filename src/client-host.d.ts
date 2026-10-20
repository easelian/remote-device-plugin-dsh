import type * as React from 'react'

type PermissionMode = 'always-ask' | 'read-only' | 'low-risk' | 'allow-all'
type ConfigState =
  | { status: 'loading' | 'unavailable' }
  | { status: 'ready'; writable: boolean; revision: unknown; value: Record<string, unknown> }

export interface SettingsProps {
  t(key: string): string
  view: string
  form?: {
    state: ConfigState
    mutate(operations: readonly { op: 'set'; path: readonly ['permissionMode']; value: PermissionMode }[], revision: unknown): boolean | Promise<boolean>
  }
}

interface ClientContext {
  effect(callback: () => unknown): unknown
  locale: { register(namespace: string, translations: Record<string, Record<string, string>>): unknown }
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: { name: string; key: string; locale: string }, component: (props: SettingsProps) => React.ReactElement): unknown
  }
}

declare global {
  interface Window {
    __ModuleLoader__: {
      load(module: {
        id: string
        factory(require: (name: 'react') => typeof React): {
          inject: string[]
          apply(ctx: ClientContext): void
        }
      }): void
    }
  }
}
