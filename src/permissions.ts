/** Permission levels shared by the Host schema and the browser settings types. */
export const PERMISSION_MODES = ['always-ask', 'read-only', 'low-risk', 'allow-all'] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];
