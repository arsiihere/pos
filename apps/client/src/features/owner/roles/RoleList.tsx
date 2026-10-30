import { Fragment, useCallback, useEffect, useState } from 'react';
import type { CloudAdmin, CloudError, Role } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { ListRow } from '../../../components/List';
import { MoreMenu } from '../../../components/MoreMenu';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, ownAdminText } from '../form';
import { Page, PeopleTabs } from '../Shell';
import { joinNames, shortDate } from '../staff/people';

// 01b §8 #/roles (01b-S03, S03a, S08, D03): active and archived roles; idle minutes are saved when the
// box is left (§6.7 note: `{ expected_version, idle_minutes }`); Archive asks first (D03) and shows the
// blocked variant on CONFIG_IN_USE or an admin guard; Restore clears `archived`.
type Show = 'active' | 'archived';
type IdleState = 'saving' | 'saved' | 'range' | 'not_saved' | 'stale';

export function peopleText(n: number): string {
  return n === 1 ? t('roles.people_one') : fill(t('roles.people'), { n: String(n) });
}

// "2 people · signs out after 30 min": the row More menu's info head and the phone row's second line.
function metaText(r: Role): string {
  return fill(t('roles.menu_info'), { people: peopleText(r.staff_count), n: String(r.idle_minutes) });
}

interface Blocked {
  title: string;
  text: string;
  detail?: string;
  open?: { label: string; href: string };
}

export function RoleList({ api }: { api: CloudAdmin }) {
  const [lists, setLists] = useState<{ active: Role[]; archived: Role[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>('active');
  const [idle, setIdle] = useState<Record<string, string>>({});
  const [idleState, setIdleState] = useState<Record<string, IdleState>>({});
  const [archiving, setArchiving] = useState<Role | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [restoreError, setRestoreError] = useState<Record<string, string>>({});
  const down = useCloudDown(api);
  const branchName = useBranchName();
  const phone = usePhone();

  const load = useCallback(async () => {
    const [active, archived] = await Promise.all([api.listRoles(), api.listRoles({ archived: true })]);
    if (active.ok && archived.ok) {
      setLists({ active: active.data.roles, archived: archived.data.roles });
      setIdle({});
      setIdleState({});
      setError(null);
      return;
    }
    const failed = !active.ok ? active : !archived.ok ? archived : null;
    if (failed !== null && !failed.ok) setError(errorText(failed.error));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(next: Role) {
    setLists((prev) => {
      if (prev === null) return prev;
      const others = (list: Role[]) => list.filter((r) => r.role_id !== next.role_id);
      // In place when the role stays in its list; appended when it moves (archive or restore).
      const put = (list: Role[]) =>
        list.some((r) => r.role_id === next.role_id) ? list.map((r) => (r.role_id === next.role_id ? next : r)) : [...list, next];
      return next.archived_at === null
        ? { active: put(prev.active), archived: others(prev.archived) }
        : { active: others(prev.active), archived: put(prev.archived) };
    });
  }

  async function saveIdle(r: Role) {
    const typed = idle[r.role_id];
    // While "Changed elsewhere" shows for this role nothing is sent again with the old version.
    if (idleState[r.role_id] === 'stale') return;
    if (typed === undefined || typed.trim() === String(r.idle_minutes)) return;
    const value = /^\d+$/.test(typed.trim()) ? Number(typed.trim()) : NaN;
    if (!(value >= 1 && value <= 240)) {
      setIdleState((s) => ({ ...s, [r.role_id]: 'range' }));
      return;
    }
    setIdleState((s) => ({ ...s, [r.role_id]: 'saving' }));
    const result = await api.patchRole(r.role_id, { expected_version: r.version, idle_minutes: value });
    if (result.ok) {
      replace(result.data.role);
      setIdle((s) => {
        const next = { ...s };
        delete next[r.role_id];
        return next;
      });
      setIdleState((s) => ({ ...s, [r.role_id]: 'saved' }));
      return;
    }
    const stale = result.error.kind === 'api' && result.error.code === 'CONFIG_STALE';
    setIdleState((s) => ({ ...s, [r.role_id]: stale ? 'stale' : 'not_saved' }));
  }

  async function blockedFor(r: Role, error: CloudError): Promise<Blocked> {
    const title = fill(t('roles.blocked_title'), { name: r.name });
    if (error.kind === 'api' && error.code === 'CONFIG_IN_USE') {
      const usedBy = error.details['used_by'] as { entity?: string; ids?: string[] } | undefined;
      const ids = usedBy?.ids ?? [];
      if (usedBy?.entity === 'role') {
        const names = ids.map((id) => lists?.active.find((x) => x.role_id === id)?.name ?? id);
        const first = ids[0];
        return {
          title,
          text: fill(t('roles.blocked_role'), { name: r.name, names: joinNames(names) }),
          detail: t('roles.blocked_role_body'),
          ...(first === undefined ? {} : { open: { label: fill(t('roles.open'), { name: names[0] ?? '' }), href: `/roles/${encodeURIComponent(first)}` } }),
        };
      }
      const staff = await api.listStaff({});
      const people = staff.ok ? staff.data.staff : [];
      const names = ids.map((id) => people.find((s) => s.staff_id === id)?.display_name ?? id);
      const first = ids[0];
      return {
        title,
        text: fill(t('roles.blocked_staff'), { names: joinNames(names) }),
        detail: t('roles.blocked_staff_body'),
        ...(first === undefined ? {} : { open: { label: fill(t('roles.open'), { name: names[0] ?? '' }), href: `/staff/${encodeURIComponent(first)}` } }),
      };
    }
    if (error.kind === 'api' && error.code === 'OWN_ADMIN_ACCESS') {
      return {
        title,
        text: ownAdminText(error.details),
      };
    }
    if (error.kind === 'api' && error.code === 'LAST_ADMIN_REQUIRED') {
      const ids = Array.isArray(error.details['branch_ids']) ? (error.details['branch_ids'] as string[]) : [];
      return {
        title,
        text: fill(t('roles.last_admin_body'), { branches: joinNames(ids.map(branchName)) }),
        detail: t('errors.LAST_ADMIN_REQUIRED'),
      };
    }
    return { title, text: errorText(error) ?? '' };
  }

  async function archive(r: Role) {
    setArchiving(null);
    const result = await api.patchRole(r.role_id, { expected_version: r.version, archived: true });
    if (result.ok) {
      replace(result.data.role);
      return;
    }
    if (result.error.kind === 'api' && result.error.code === 'CONFIG_STALE') {
      setIdleState((s) => ({ ...s, [r.role_id]: 'stale' }));
      return;
    }
    setBlocked(await blockedFor(r, result.error));
  }

  async function restore(r: Role) {
    if (idleState[r.role_id] === 'stale') return;
    const result = await api.patchRole(r.role_id, { expected_version: r.version, archived: false });
    if (result.ok) {
      replace(result.data.role);
      return;
    }
    // Owner decision 2026-10-30 (01b P1): a stale Restore is not sent again with the old version; Reload first.
    if (result.error.kind === 'api' && result.error.code === 'CONFIG_STALE') {
      setIdleState((s) => ({ ...s, [r.role_id]: 'stale' }));
      return;
    }
    const taken = result.error.kind === 'api' && result.error.code === 'CONFIG_NAME_TAKEN';
    setRestoreError((s) => ({ ...s, [r.role_id]: taken ? fill(t('roles.name_taken_restore'), { name: r.name }) : (errorText(result.error) ?? '') }));
  }

  // RolesStale: while a row's Reload shows, it is the one primary and New role turns secondary.
  const anyStale = Object.values(idleState).includes('stale');
  const add = (
    <button type="button" className={`pos-btn${anyStale ? '' : ' pos-btn--primary'}`} disabled={down} onClick={() => navigate('/roles/new')}>
      <Icon name="plus" />
      {phone ? t('roles.new_short') : t('roles.new')}
    </button>
  );

  // Row More menu (RolesRowMenu): info head "{role} · {n} people · signs out after {n} min", one danger item.
  const more = (r: Role) => (
    <MoreMenu
      label={fill(t('common.more_for'), { name: r.name })}
      info={{ title: r.name, detail: metaText(r) }}
      items={[
        {
          label: fill(t('roles.menu_archive'), { role: r.name }),
          icon: 'archive',
          danger: true,
          // A stale role is reloaded first: nothing is sent with the old version.
          disabled: down || idleState[r.role_id] === 'stale',
          onSelect: () => setArchiving(r),
        },
      ]}
    />
  );

  const name = (r: Role, meta: string) => (
    <div className="pos-list__name">
      <strong className="pos-roles__name">
        {r.name}
        {r.is_default && <Chip icon="lock">{t('roles.default')}</Chip>}
      </strong>
      <span>{meta}</span>
    </div>
  );

  // Owner decision 2026-10-30 (01b proposal P1; same as 01c §8): the typed minutes stay in the box until
  // Reload, which reads the current roles; nothing is retried.
  const reloadBanner = <StaleBanner onReload={() => void load()} />;

  // RolesStale: the Reload banner takes a full-width row just above the role it is about.
  const activeRow = (r: Role) =>
    idleState[r.role_id] === 'stale' ? (
      <Fragment key={r.role_id}>
        <li className="pos-list__row pos-roles__stale">{reloadBanner}</li>
        {roleRow(r)}
      </Fragment>
    ) : (
      roleRow(r)
    );

  // S08 inline idle box: blur saves; the chip or the range error follows it.
  const idleBox = (r: Role) => {
    const range = idleState[r.role_id] === 'range';
    return (
      <>
        <label className="pos-row pos-roles__idle">
          <span className="label">{t('roles.idle')}</span>
          <span className={`pos-input-affix pos-roles__affix${range ? ' is-error' : ''}`}>
            <input
              className="pos-input pos-input--mono"
              inputMode="numeric"
              aria-label={r.name}
              aria-invalid={range ? true : undefined}
              disabled={down}
              value={idle[r.role_id] ?? String(r.idle_minutes)}
              onChange={(e) => {
                const value = e.target.value;
                setIdle((s) => ({ ...s, [r.role_id]: value }));
                setIdleState((s) => {
                  if (s[r.role_id] === 'stale') return s;
                  const next = { ...s };
                  delete next[r.role_id];
                  return next;
                });
              }}
              onBlur={() => void saveIdle(r)}
            />
            <span>{t('roles.min')}</span>
          </span>
        </label>
        {!range && <IdleChip state={idleState[r.role_id]} />}
      </>
    );
  };
  const rangeError = (r: Role) =>
    idleState[r.role_id] === 'range' && (
      <span className="pos-field__error pos-roles__range">
        <Icon name="alert" />
        {t('roles.idle_range')}
      </span>
    );
  const edit = (r: Role) => (
    <button type="button" className="pos-btn" onClick={() => navigate(`/roles/${encodeURIComponent(r.role_id)}`)}>
      {t('roles.edit')}
    </button>
  );

  const roleRow = (r: Role) => {
    if (phone) {
      // RolesPhone: name + people, Edit and ⋯; the S08 idle box stays on its own line under them.
      return (
        <ListRow key={r.role_id}>
          <div className="pos-prow">
            {name(r, peopleText(r.staff_count))}
            {edit(r)}
            {more(r)}
          </div>
          <div className="pos-roles__phoneidle">
            {idleBox(r)}
            {rangeError(r)}
          </div>
        </ListRow>
      );
    }
    return (
      <ListRow key={r.role_id}>
        {name(r, peopleText(r.staff_count))}
        <div className="pos-list__side">
          {idleBox(r)}
          {edit(r)}
          {more(r)}
          {rangeError(r)}
        </div>
      </ListRow>
    );
  };

  let body;
  if (lists === null) {
    body = error === null ? <Skeleton lines={6} /> : null;
  } else {
    const rows = show === 'active' ? lists.active : lists.archived;
    body = (
      <>
        <div className="pos-row pos-row--apart">
          {!phone && <p className={`${typeClass('body')} pos-roles__intro`}>{t('roles.intro')}</p>}
          <Segmented
            label={t('roles.show')}
            value={show}
            onChange={setShow}
            options={[
              { value: 'active', label: t('roles.active'), count: lists.active.length },
              { value: 'archived', label: t('roles.archived'), count: lists.archived.length },
            ]}
          />
        </div>
        {show === 'archived' && rows.length === 0 ? (
          <EmptyState title={t('roles.archived_empty')} body={t('roles.archived_empty_body')} />
        ) : (
          <ul className={`pos-list ${phone ? 'pos-list--stack' : 'pos-list--rows'} pos-list--roles`}>
            {rows.map((r) =>
              show === 'active' ? (
                activeRow(r)
              ) : (
                <Fragment key={r.role_id}>
                  {idleState[r.role_id] === 'stale' && <li className="pos-list__row pos-roles__stale">{reloadBanner}</li>}
                  <ListRow muted>
                    <div className="pos-list__name">
                      <strong>{r.name}</strong>
                      <span>
                        {r.archived_at === null ? '' : fill(t('roles.archived_on'), { date: shortDate(r.archived_at) })} · {t('roles.nobody_has')}
                      </span>
                    </div>
                    <div className="pos-list__side">
                      {restoreError[r.role_id] !== undefined ? (
                        <span className="pos-field__error">{restoreError[r.role_id]}</span>
                      ) : (
                        <button type="button" className="pos-btn" disabled={down || idleState[r.role_id] === 'stale'} onClick={() => void restore(r)}>
                          {t('roles.restore')}
                        </button>
                      )}
                    </div>
                  </ListRow>
                </Fragment>
              ),
            )}
          </ul>
        )}
        <p className="pos-note">{show === 'active' ? t('roles.idle_explain') : t('roles.restore_explain')}</p>
      </>
    );
  }

  return (
    <Page api={api} title={t('roles.title')} end={add}>
      <PeopleTabs current="roles" />
      {error !== null && <Banner tone="danger" text={error} />}
      {body}
      {archiving !== null && (
        <Dialog
          title={fill(t('roles.archive_title'), { name: archiving.name })}
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button type="button" className="pos-btn" onClick={() => setArchiving(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="pos-btn pos-btn--danger" onClick={() => void archive(archiving)}>
                {fill(t('roles.archive_confirm'), { name: archiving.name })}
              </button>
            </>
          }
        >
          <p className="pos-dialog__body">
            {archiving.staff_count === 0 ? t('roles.archive_body_none') : fill(t('roles.archive_body'), { n: String(archiving.staff_count) })}
          </p>
        </Dialog>
      )}
      {blocked !== null && (
        <Dialog
          title={blocked.title}
          onClose={() => setBlocked(null)}
          footer={
            <>
              {blocked.open === undefined ? (
                <button type="button" className="pos-btn pos-btn--primary" onClick={() => setBlocked(null)}>
                  {t('roles.ok')}
                </button>
              ) : (
                <button type="button" className="pos-btn" onClick={() => setBlocked(null)}>
                  {t('common.close')}
                </button>
              )}
              {blocked.open !== undefined && (
                <button type="button" className="pos-btn pos-btn--primary" onClick={() => navigate(blocked.open?.href ?? '/roles')}>
                  {blocked.open.label}
                </button>
              )}
            </>
          }
        >
          <Banner tone="danger" text={blocked.text} detail={blocked.detail} />
        </Dialog>
      )}
    </Page>
  );
}

function IdleChip({ state }: { state: IdleState | undefined }) {
  switch (state) {
    case 'saving':
      return <Chip tone="info">{t('roles.idle_saving')}</Chip>;
    case 'saved':
      return <Chip tone="ok">{t('common.saved')}</Chip>;
    case 'not_saved':
      return (
        <Chip tone="warn" icon="alert">
          {t('roles.idle_not_saved')}
        </Chip>
      );
    default:
      return null;
  }
}
