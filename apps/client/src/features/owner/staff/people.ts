import { PERMISSIONS, type Permission, type Scope } from '@pos/domain';
import type { Role, Staff } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { language, t } from '../../../i18n';

// 01b §8: helpers shared by the staff, roles and teams views.

export function shortDate(ms: number): string {
  return new Intl.DateTimeFormat(language() === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short' }).format(ms);
}

// "Bilal, Ali R." / "Bilal or Ali R." in the reading order of the list.
export function joinNames(names: readonly string[], word: 'and' | 'or' = 'and'): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${t(word === 'and' ? 'common.and' : 'staff.or')} ${names.at(-1) ?? ''}`;
}

export function roleNames(roles: ReadonlyMap<string, Role>, ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const found = roles.get(id);
    return found === undefined ? [] : [found.name];
  });
}

export type Effective =
  | { grant: 'denied' }
  | { grant: 'not_granted' }
  | { grant: 'allowed' | 'requires_approval'; scope: Scope; approver_role_ids: string[]; from_role_ids: string[] };

// Wider first (§3.3): branch > my_floors = my_team = my_stations = my_zones > own_tables.
const WIDTH: Record<Scope, number> = { branch: 2, my_floors: 1, my_team: 1, my_stations: 1, my_zones: 1, own_tables: 0 };

// 01b §3.3 resolve(), client side for C02 (§8: "computed client-side with the §3.3 rule from §6.5's roles").
export function resolve(roles: readonly Role[], denied: readonly Permission[], permission: Permission): Effective {
  if (denied.includes(permission)) return { grant: 'denied' };
  const granting = roles.flatMap((r) => r.grants.filter((g) => g.permission === permission).map((g) => ({ role: r, grant: g })));
  const winner = granting.some((x) => x.grant.grant_type === 'allowed')
    ? 'allowed'
    : granting.some((x) => x.grant.grant_type === 'requires_approval')
      ? 'requires_approval'
      : null;
  if (winner === null) return { grant: 'not_granted' };
  const winning = granting.filter((x) => x.grant.grant_type === winner);
  const scope = winning.map((x) => x.grant.scope).reduce((a, b) => (WIDTH[b] > WIDTH[a] ? b : a));
  const approvers = winner === 'requires_approval' ? [...new Set(winning.flatMap((x) => x.grant.approver_role_ids))].sort() : [];
  return { grant: winner, scope, approver_role_ids: approvers, from_role_ids: winning.map((x) => x.role.role_id) };
}

export interface CanRow {
  permission: Permission;
  effective: Effective;
  // Differs from what the stored person has (C02 `is-changed`).
  changed: boolean;
}

export function canRows(
  roles: ReadonlyMap<string, Role>,
  next: { role_ids: readonly string[]; denied: readonly Permission[] },
  stored: Staff | null,
): CanRow[] {
  const pick = (ids: readonly string[]) => ids.flatMap((id) => roles.get(id) ?? []);
  const now = pick(next.role_ids);
  const before = stored === null ? null : pick(stored.role_ids);
  return PERMISSIONS.map((permission) => {
    const effective = resolve(now, next.denied, permission);
    const was = before === null || stored === null ? null : resolve(before, stored.denied_permissions, permission);
    return { permission, effective, changed: was !== null && JSON.stringify(was) !== JSON.stringify(effective) };
  });
}

// The C02 small line: "Allowed · from Shift lead · on their floors".
export function canDetail(roles: ReadonlyMap<string, Role>, effective: Effective): string {
  switch (effective.grant) {
    case 'denied':
      return `${t('staff.grant.denied')} · ${t('staff.grant.blocked')}`;
    case 'not_granted':
      return `${t('staff.grant.not_granted')} · ${t('staff.grant.no_role')}`;
    default: {
      const parts = [t(`staff.grant.${effective.grant}`)];
      if (effective.grant === 'requires_approval') {
        parts.push(fill(t('staff.grant.approved_by'), { roles: joinNames(roleNames(roles, effective.approver_role_ids), 'or') }));
      } else {
        parts.push(fill(t('staff.grant.from'), { roles: joinNames(roleNames(roles, effective.from_role_ids)) }));
      }
      if (effective.scope !== 'branch') parts.push(t(`staff.scope.${effective.scope}`));
      return parts.join(' · ');
    }
  }
}

// §8: "Floors they work on" shows only when one of the person's roles has a my_floors grant.
export function floorsRole(roles: ReadonlyMap<string, Role>, roleIds: readonly string[]): Role | null {
  for (const id of roleIds) {
    const found = roles.get(id);
    if (found?.grants.some((g) => g.scope === 'my_floors')) return found;
  }
  return null;
}
