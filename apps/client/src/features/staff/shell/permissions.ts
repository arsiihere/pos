import type { Permission, Scope } from '@pos/domain';
import type { Resolution } from '../api';

// 02a §3.15, §8 Rules (R5): buttons from the session's effective permissions, kept whole (grant + scope).
// `requires_approval` counts as not granted, except where a spec offers "Ask for approval" (comp, 02b §3.9),
// which reads `requiresApproval`. Q-15: by grant only — the client has no floor list.

export interface Permissions {
  resolution(p: Permission): Resolution;
  /** granted outright (`allowed`) */
  allowed(p: Permission): boolean;
  requiresApproval(p: Permission): boolean;
  /** the scope of a granting result, else null */
  scope(p: Permission): Scope | null;
}

export function createPermissions(map: Record<string, Resolution> | null): Permissions {
  const resolution = (p: Permission): Resolution => map?.[p] ?? { grant: 'not_granted' };
  return {
    resolution,
    allowed: (p) => resolution(p).grant === 'allowed',
    requiresApproval: (p) => resolution(p).grant === 'requires_approval',
    scope: (p) => {
      const r = resolution(p);
      return 'scope' in r ? r.scope : null;
    },
  };
}
