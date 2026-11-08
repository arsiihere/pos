import { PERMISSION_CATALOGUE, PERMISSIONS, type Permission, type PermissionGroup, type Scope } from '@pos/domain';
import type { RolePatchRequest } from '@pos/events';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, Role } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { ActionBar } from '../../../components/ActionBar';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Disclosure } from '../../../components/Disclosure';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill, type MessageKey } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, ownAdminText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { Page } from '../Shell';
import { joinNames } from '../staff/people';

// 01b §8 #/roles/:id and #/roles/new (01b-S04, C01): name, idle minutes and one grant control per
// permission, grouped as PERMISSION_CATALOGUE. "Approved by" is a multi-select of role chips (the role
// itself included, §6.6); "Where" offers only PERMISSION_SCOPES[permission] and shows when there is a
// choice. A PATCH sends `expected_version` and the changed fields (grants whole, §6.7). An admin guard
// (§3.4) snaps the two admin grants back to the stored ones and says why. `409 CONFIG_STALE` shows "Changed
// elsewhere" and keeps the draft until Reload (owner decision 2026-10-30, 01b proposal P1; same as 01c §8).
type GrantType = 'allowed' | 'requires_approval' | 'not_granted';

interface GrantDraft {
  grant_type: GrantType;
  scope: Scope;
  approvers: string[];
}

type Grants = Record<Permission, GrantDraft>;

const GROUPS: PermissionGroup[] = ['orders', 'kitchen', 'bills', 'menu_stock', 'people', 'reports'];
const ADMIN: Permission[] = ['access-hub-admin', 'manage-devices'];

function grantsOf(role: Role | null): Grants {
  return Object.fromEntries(
    PERMISSIONS.map((p) => {
      const found = role?.grants.find((g) => g.permission === p);
      return [
        p,
        found === undefined
          ? { grant_type: 'not_granted', scope: 'branch', approvers: [] }
          : { grant_type: found.grant_type, scope: found.scope, approvers: [...found.approver_role_ids] },
      ];
    }),
  ) as Grants;
}

function wire(grants: Grants) {
  return PERMISSIONS.flatMap((permission) => {
    const g = grants[permission];
    if (g.grant_type === 'not_granted') return [];
    return [
      {
        permission,
        grant_type: g.grant_type,
        approver_role_ids: g.grant_type === 'requires_approval' ? [...g.approvers].sort() : [],
        scope: g.scope,
      },
    ];
  });
}

export function RoleEditor({ api, roleId }: { api: CloudAdmin; roleId: string }) {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const result = await api.listRoles();
    if (result.ok) {
      setRoles(result.data.roles);
      setLoadError(null);
      setGeneration((g) => g + 1);
    } else {
      setLoadError(errorText(result.error));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink />;

  if (roles === null) {
    return (
      <Page api={api} title={t('roles.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={8} />}
      </Page>
    );
  }
  const role = roleId === 'new' ? null : (roles.find((r) => r.role_id === roleId) ?? null);
  if (roleId !== 'new' && role === null) {
    return (
      <Page api={api} title={t('roles.title')} start={back}>
        <EmptyState title={t('roles.not_found')} body={t('roles.not_found_body')}>
          <a className="pos-btn pos-btn--primary" href="#/roles">
            {t('roles.back')}
          </a>
        </EmptyState>
      </Page>
    );
  }
  return <Editor key={generation} api={api} roles={roles} role={role} back={back} onReload={() => void load()} />;
}

// Phone (RoleEditorPhone): the back arrow alone. With no Cancel on phone it is the way out, so it goes through
// the unsaved-changes guard (S50 c) like Cancel does.
function BackLink() {
  const phone = usePhone();
  const leave = useLeave();
  return (
    <a
      className="pos-btn"
      href="#/roles"
      aria-label={t('roles.back')}
      onClick={(e) => {
        e.preventDefault();
        leave(() => navigate('/roles'));
      }}
    >
      <Icon name="back" flip />
      {!phone && t('roles.title')}
    </a>
  );
}

// "3 allowed · 2 needs approval": a group's count summary; zero counts are left out (RoleEditor frame).
function groupSummary(group: PermissionGroup, grants: Grants): string {
  const inGroup = PERMISSION_CATALOGUE.filter((entry) => entry.group === group).map((entry) => grants[entry.key].grant_type);
  const parts: [GrantType, MessageKey][] = [
    ['allowed', 'role_editor.count_allowed'],
    ['requires_approval', 'role_editor.count_approval'],
    ['not_granted', 'role_editor.count_not'],
  ];
  return parts
    .map(([type, key]) => [inGroup.filter((g) => g === type).length, key] as const)
    .filter(([n]) => n > 0)
    .map(([n, key]) => fill(t(key), { n: String(n) }))
    .join(' · ');
}

const groupOf = (permission: Permission): PermissionGroup =>
  PERMISSION_CATALOGUE.find((entry) => entry.key === permission)?.group ?? 'orders';

function Editor({
  api,
  roles,
  role,
  back,
  onReload,
}: {
  api: CloudAdmin;
  roles: Role[];
  role: Role | null;
  back: ReactNode;
  onReload: () => void;
}) {
  const [stored, setStored] = useState<Role | null>(role);
  const [name, setName] = useState(role?.name ?? '');
  const [idle, setIdle] = useState(String(role?.idle_minutes ?? 10));
  const [grants, setGrants] = useState<Grants>(() => grantsOf(role));
  const [errors, setErrors] = useState<{ name?: string; idle?: string; grants?: Partial<Record<Permission, string>> }>({});
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string; detail?: string } | null>(null);
  const [snapped, setSnapped] = useState<{ permissions: Permission[]; title: string; text: string; detail?: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const branchName = useBranchName();
  const phone = usePhone();
  // 01b-S04: on open the first group is open; a group with an error or a snapped-back control opens too.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<PermissionGroup>>(() => new Set([GROUPS[0] ?? 'orders']));
  const openGroupsOf = (permissions: readonly Permission[]) => {
    if (permissions.length === 0) return;
    setOpenGroups((prev) => new Set([...prev, ...permissions.map(groupOf)]));
  };

  const approverRoles = roles.filter((r) => r.archived_at === null);
  const title = role === null ? t('roles.new_title') : fill(t('roles.edit_title'), { name: role.name });
  const idleValue = /^\d+$/.test(idle.trim()) ? Number(idle.trim()) : NaN;

  const patch: Omit<RolePatchRequest, 'expected_version'> = {};
  if (stored !== null) {
    if (name.trim() !== stored.name) patch.name = name.trim();
    if (idleValue !== stored.idle_minutes) patch.idle_minutes = idleValue;
    if (JSON.stringify(wire(grants)) !== JSON.stringify(wire(grantsOf(stored)))) patch.grants = wire(grants);
  }
  const fieldLabel: Record<string, string> = { name: t('roles.name'), idle_minutes: t('roles.idle'), grants: t('roles.approved_by') };
  const changed =
    stored === null ? (name.trim() !== '' || wire(grants).length > 0 ? [t('roles.name')] : []) : Object.keys(patch).map((k) => fieldLabel[k] ?? k);
  useDirtyForm(changed.length === 0 ? null : { name: name.trim() || title, fields: changed });

  function setGrant(permission: Permission, next: Partial<GrantDraft>) {
    setGrants((prev) => ({ ...prev, [permission]: { ...prev[permission], ...next } }));
    setErrors((prev) => {
      if (prev.grants?.[permission] === undefined) return prev;
      const rest = { ...prev.grants };
      delete rest[permission];
      return { ...prev, grants: rest };
    });
  }

  function validate(): boolean {
    const found: typeof errors = {};
    const labels: string[] = [];
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 40) {
      found.name = t('roles.name_required');
      labels.push(t('roles.name'));
    }
    if (!(idleValue >= 1 && idleValue <= 240)) {
      found.idle = t('roles.idle_range');
      labels.push(t('roles.idle'));
    }
    for (const p of PERMISSIONS) {
      if (grants[p].grant_type === 'requires_approval' && grants[p].approvers.length === 0) {
        found.grants = { ...found.grants, [p]: t('roles.approver_required') };
        labels.push(t(`perm.${p}`));
      }
    }
    setErrors(found);
    openGroupsOf(Object.keys(found.grants ?? {}) as Permission[]);
    if (labels.length > 0) {
      setBanner({
        tone: 'danger',
        text: labels.length === 1 ? t('staff.fix_one') : fill(t('staff.fix_count'), { n: String(labels.length) }),
        detail: labels.join(' · '),
      });
    }
    return labels.length === 0;
  }

  function showError(error: CloudError) {
    if (error.kind === 'network') {
      setBanner({ tone: 'warn', text: t('staff.offline') });
      return;
    }
    if (error.kind === 'api') {
      const ids = Array.isArray(error.details['branch_ids']) ? (error.details['branch_ids'] as string[]) : [];
      switch (error.code) {
        case 'CONFIG_STALE':
          setStale(true);
          setBanner(null);
          return;
        case 'CONFIG_NAME_TAKEN':
          setErrors({ name: fill(t('roles.name_taken'), { name: name.trim() }) });
          setBanner({ tone: 'danger', text: t('staff.fix_one'), detail: t('roles.name') });
          return;
        case 'OWN_ADMIN_ACCESS':
        case 'LAST_ADMIN_REQUIRED': {
          // Snap the admin grants back to the stored ones (C01 "snapped back").
          const back = grantsOf(stored);
          const moved = ADMIN.filter((p) => JSON.stringify(grants[p]) !== JSON.stringify(back[p]));
          setGrants((prev) => ({ ...prev, ...Object.fromEntries(ADMIN.map((p) => [p, back[p]])) }));
          openGroupsOf(moved);
          const own = error.code === 'OWN_ADMIN_ACCESS';
          setSnapped({
            permissions: moved,
            title: own ? t('roles.own_admin_title') : fill(t('roles.last_admin_title'), { name: stored?.name ?? name.trim() }),
            text: own
              ? ownAdminText(error.details)
              : fill(t('roles.last_admin_body'), { branches: joinNames(ids.map(branchName)) }),
            ...(own ? {} : { detail: t('errors.LAST_ADMIN_REQUIRED') }),
          });
          return;
        }
      }
    }
    setBanner({ tone: 'danger', text: errorText(error) ?? '' });
  }

  async function save() {
    if (!validate()) return;
    setBanner(null);
    setSnapped(null);
    if (stored === null) {
      setBusy(true);
      const result = await api.createRole({ name: name.trim(), idle_minutes: idleValue, grants: wire(grants) }, key);
      setBusy(false);
      if (result.ok) {
        renew();
        setStored(result.data.role);
        navigate('/roles');
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    if (Object.keys(patch).length === 0) {
      navigate('/roles');
      return;
    }
    setBusy(true);
    const result = await api.patchRole(stored.role_id, { expected_version: stored.version, ...patch });
    setBusy(false);
    if (result.ok) {
      setStored(result.data.role);
      setGrants(grantsOf(result.data.role));
      navigate('/roles');
      return;
    }
    showError(result.error);
  }

  // B03: while the stale banner shows, Reload is the one primary and Save is disabled and secondary.
  const saveButton = (
    <BusyButton primary={!stale} busy={busy} disabled={down || stale} size={phone ? 'lg block' : undefined} onClick={() => void save()}>
      {t('roles.save')}
    </BusyButton>
  );
  const actions = (
    <>
      <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/roles'))}>
        {t('common.cancel')}
      </button>
      {saveButton}
    </>
  );
  const grantsHelp = `${t('roles.explain_allowed')}${t('roles.explain_allowed_text')}${t('roles.explain_approval')}${t('roles.explain_approval_text')}${t('roles.explain_not')}${t('roles.explain_not_text')}`;

  return (
    <Page api={api} title={title} start={back} end={phone ? undefined : actions}>
      {stale && <StaleBanner onReload={onReload} />}
      {banner !== null && <Banner tone={banner.tone} text={banner.text} detail={banner.detail} />}
      <section className="pos-section">
        <div className="pos-grid">
          <label className={`pos-field${errors.name !== undefined ? ' pos-field--error' : ''}`}>
            <span className="pos-field__label">{t('roles.name')}</span>
            <input className="pos-input" name="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            {errors.name !== undefined ? (
              <span className="pos-field__error">{errors.name}</span>
            ) : (
              <span className="pos-field__help">{t('roles.name_help')}</span>
            )}
          </label>
          <label className={`pos-field${errors.idle !== undefined ? ' pos-field--error' : ''}`}>
            <span className="pos-field__label">{t('roles.idle')}</span>
            <span className="pos-input-affix pos-roleeditor__idle">
              <input className="pos-input pos-input--mono" name="idle_minutes" inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} />
              <span>{t('roles.min')}</span>
            </span>
            {errors.idle !== undefined ? (
              <span className="pos-field__error">{errors.idle}</span>
            ) : (
              <span className="pos-field__help">{t('roles.idle_help')}</span>
            )}
          </label>
        </div>
      </section>
      <button type="button" className="pos-hint" title={grantsHelp} aria-label={grantsHelp}>
        <Icon name="info" />
        {t('role_editor.grants_help')}
      </button>
      {GROUPS.map((group) => (
        <Disclosure
          key={group}
          variant="group"
          title={t(`roles.group.${group}`)}
          summary={groupSummary(group, grants)}
          open={openGroups.has(group)}
          onOpenChange={(open) =>
            setOpenGroups((prev) => {
              const next = new Set(prev);
              if (open) next.add(group);
              else next.delete(group);
              return next;
            })
          }
        >
          <ul className="pos-grants">
            {PERMISSION_CATALOGUE.filter((entry) => entry.group === group).map((entry) => (
              <GrantControl
                key={entry.key}
                permission={entry.key}
                scopes={entry.scopes}
                grant={grants[entry.key]}
                roles={approverRoles}
                error={errors.grants?.[entry.key]}
                snapped={snapped?.permissions.includes(entry.key) ?? false}
                stack={phone}
                onChange={(next) => setGrant(entry.key, next)}
              />
            ))}
          </ul>
        </Disclosure>
      ))}
      {phone && (
        <div className="pos-roleeditor__bar">
          <ActionBar>{saveButton}</ActionBar>
        </div>
      )}
      {snapped !== null && (
        <Dialog
          title={snapped.title}
          onClose={() => setSnapped(null)}
          footer={
            <button type="button" className="pos-btn pos-btn--primary" onClick={() => setSnapped(null)}>
              {t('roles.ok')}
            </button>
          }
        >
          <Banner tone="danger" text={snapped.text} detail={snapped.detail} />
        </Dialog>
      )}
    </Page>
  );
}

// C01: one row per permission; the extra controls appear only when they mean something.
function GrantControl({
  permission,
  scopes,
  grant,
  roles,
  error,
  snapped,
  stack,
  onChange,
}: {
  permission: Permission;
  scopes: readonly Scope[];
  grant: GrantDraft;
  roles: readonly Role[];
  error: string | undefined;
  snapped: boolean;
  stack: boolean;
  onChange: (next: Partial<GrantDraft>) => void;
}) {
  const label = t(`perm.${permission}`);
  const granted = grant.grant_type !== 'not_granted';
  const where = granted && scopes.length > 1;
  return (
    <li className={`pos-grant${stack ? ' pos-grant--stack' : ''}${error !== undefined ? ' is-error' : ''}${snapped ? ' is-snapped' : ''}`}>
      <div className="pos-grant__label">
        {label}
        {snapped && <small>{t('roles.snapped')}</small>}
      </div>
      <Segmented<GrantType>
        label={label}
        value={grant.grant_type}
        onChange={(grant_type) => onChange({ grant_type })}
        options={[
          { value: 'allowed', label: t('roles.grant.allowed') },
          { value: 'requires_approval', label: t('roles.grant.requires_approval') },
          { value: 'not_granted', label: t('roles.grant.not_granted') },
        ]}
      />
      {grant.grant_type === 'requires_approval' || where ? (
        <div className="pos-grant__more">
          {grant.grant_type === 'requires_approval' && (
            <div className="pos-grant__more">
              <span className="pos-grant__sub">{t('roles.approved_by')}</span>
              <div className="pos-row" role="group" aria-label={t('roles.approved_by')}>
                {roles.map((r) => (
                  <button
                    key={r.role_id}
                    type="button"
                    className="pos-chip"
                    aria-pressed={grant.approvers.includes(r.role_id)}
                    onClick={() =>
                      onChange({
                        approvers: grant.approvers.includes(r.role_id)
                          ? grant.approvers.filter((id) => id !== r.role_id)
                          : [...grant.approvers, r.role_id],
                      })
                    }
                  >
                    {grant.approvers.includes(r.role_id) && <Icon name="check" />}
                    {r.name}
                  </button>
                ))}
              </div>
              {error !== undefined ? (
                <span className="pos-field__error">{error}</span>
              ) : (
                <span className="pos-field__help">{t('roles.approval_help')}</span>
              )}
            </div>
          )}
          {where && (
            <label className="pos-grant__more">
              <span className="pos-grant__sub">{t('roles.where')}</span>
              <select
                className="pos-select"
                aria-label={t('roles.where')}
                value={grant.scope}
                onChange={(e) => onChange({ scope: e.target.value as Scope })}
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {t(`roles.scope.${s}`)}
                  </option>
                ))}
              </select>
              {grant.scope !== 'branch' && grant.scope !== 'own_tables' && (
                <span className="pos-field__help">
                  {permission === 'manage-stations' && grant.scope === 'my_stations'
                    ? t('roles.scope_help.manage_stations')
                    : t(`roles.scope_help.${grant.scope}`)}
                </span>
              )}
            </label>
          )}
        </div>
      ) : (
        <span />
      )}
    </li>
  );
}
