import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { usePhone } from '../../../app/phone';
import type { CloudAdmin, Role, Staff } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { Page } from '../Shell';
import { PinDialog } from './PinDialog';
import { roleNames, shortDate } from './people';

// 01b §8 #/staff (01b-S01, B02): everyone of the tenant, Working here / Left, a branch filter and a
// client-side name search (§6.1: no `q`). Reset PIN opens D01 in place; the row (and its chevron link,
// hand-off 01b-S01) opens #/staff/:id.
type Status = 'active' | 'left';

// B02: the form's save notice, shown once on the list it returns to.
let notice: string | null = null;
export function noteSaved(text: string): void {
  notice = text;
}

export function StaffList({ api, branchIds }: { api: CloudAdmin; branchIds: readonly string[] }) {
  const [lists, setLists] = useState<{ active: Staff[]; left: Staff[]; roles: Role[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('active');
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('');
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const [saved] = useState(() => {
    const text = notice;
    notice = null;
    return text;
  });
  const down = useCloudDown(api);
  const branchName = useBranchName();
  const phone = usePhone();

  const load = useCallback(async () => {
    const [active, left, roles] = await Promise.all([api.listStaff({}), api.listStaff({ status: 'left' }), api.listRoles()]);
    if (active.ok && left.ok && roles.ok) {
      setLists({ active: active.data.staff, left: left.data.staff, roles: roles.data.roles });
      setError(null);
      return;
    }
    const failed = [active, left, roles].find((r) => !r.ok);
    if (failed !== undefined && !failed.ok) setError(errorText(failed.error));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const roles = useMemo(() => new Map((lists?.roles ?? []).map((r) => [r.role_id, r])), [lists]);
  const all = lists === null ? [] : status === 'active' ? lists.active : lists.left;
  const needle = query.trim().toLowerCase();
  const shown = all.filter(
    (s) => (branch === '' || s.branch_ids.includes(branch)) && (needle === '' || s.display_name.toLowerCase().includes(needle)),
  );

  function replace(next: Staff) {
    setLists((prev) =>
      prev === null ? prev : { ...prev, active: prev.active.map((s) => (s.staff_id === next.staff_id ? next : s)) },
    );
  }

  const firstRun = lists !== null && lists.active.length === 0 && lists.left.length === 0;
  // Phone rush search (hand-off 01b-S01): the first match's Reset PIN is the one primary, Add steps back.
  const rush = phone && needle !== '' && status === 'active' && shown.some((s) => s.is_active);

  const add = firstRun ? null : (
    <button
      type="button"
      className={`pos-btn${rush ? '' : ' pos-btn--primary'}`}
      disabled={down}
      aria-label={phone ? t('staff.add') : undefined}
      onClick={() => navigate('/staff/new')}
    >
      <Icon name="plus" />
      {phone ? t('staff.add_short') : t('staff.add')}
    </button>
  );

  const toolbar = (
    <div className={phone ? 'pos-staff__bar pos-staff__bar--phone' : 'pos-row pos-staff__bar'}>
      <div className={phone ? 'pos-staff__filters' : 'pos-row'}>
        <label className="pos-input-affix pos-staff__search">
          <span>
            <Icon name="search" />
          </span>
          <input
            className="pos-input"
            type="search"
            value={query}
            placeholder={t('staff.find')}
            aria-label={t('staff.find')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {branchIds.length > 1 && (
          <select
            className="pos-select pos-staff__branch"
            aria-label={t('owner.branch')}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">{t('staff.all_branches')}</option>
            {branchIds.map((id) => (
              <option key={id} value={id}>
                {branchName(id)}
              </option>
            ))}
          </select>
        )}
      </div>
      <Segmented
        label={t('staff.status')}
        value={status}
        onChange={setStatus}
        block={phone}
        options={[
          { value: 'active', label: t('staff.working'), count: lists?.active.length },
          { value: 'left', label: t('staff.left'), count: lists?.left.length },
        ]}
      />
    </div>
  );

  let body;
  if (lists === null) {
    body =
      error === null ? (
        phone ? (
          <Skeleton lines={6} />
        ) : (
          <>
            {toolbar}
            <ul className="pos-list pos-list--staff" aria-busy="true" aria-label={t('common.loading')}>
              <StaffHead />
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="pos-list__row pos-staff__loading">
                  <span className="pos-skeleton" />
                  <span className="pos-skeleton" />
                  <span className="pos-skeleton" />
                  <span className="pos-skeleton" />
                  <div className="pos-list__acts">
                    <span className="pos-skeleton" />
                    <span className="pos-skeleton" />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null;
  } else if (firstRun) {
    const active = lists.roles.filter((r) => r.archived_at === null);
    body = (
      <div className="pos-empty pos-card">
        <Icon name="user" />
        <h3>{t('staff.empty_title')}</h3>
        <p className={`${typeClass('body')} pos-staff__empty-body`}>{t('staff.empty_body')}</p>
        <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" disabled={down} onClick={() => navigate('/staff/new')}>
          <Icon name="plus" />
          {t('staff.add')}
        </button>
        <p className={typeClass('caption')}>
          {fill(t('staff.empty_roles'), { n: String(active.length), names: active.map((r) => r.name).join(', ') })}
        </p>
      </div>
    );
  } else {
    body = (
      <>
        {toolbar}
        {shown.length === 0 ? (
          needle !== '' ? (
            <EmptyState card icon="search" title={fill(t('staff.no_match'), { q: query.trim() })} body={t('staff.no_match_body')} />
          ) : branch !== '' && status === 'active' ? (
            <EmptyState card icon="user" title={fill(t('staff.branch_empty'), { branch: branchName(branch) })} body={t('staff.branch_empty_body')} />
          ) : (
            <EmptyState card icon="user" title={t('staff.left_empty')} />
          )
        ) : phone ? (
          <PhoneRows rows={shown} roles={roles} down={down} rush={rush} onPin={setPinFor} branchName={branchName} />
        ) : (
          <StaffRows rows={shown} roles={roles} down={down} onPin={setPinFor} branchName={branchName} />
        )}
      </>
    );
  }

  return (
    <Page api={api} title={t('staff.title')} end={add}>
      {saved !== null && <Banner tone="ok" text={saved} />}
      {error !== null && <Banner tone="danger" text={error} />}
      {body}
      {pinFor !== null && (
        <PinDialog
          api={api}
          staff={pinFor}
          branchNames={pinFor.branch_ids.map(branchName)}
          onSaved={replace}
          onClose={() => setPinFor(null)}
        />
      )}
    </Page>
  );
}

const open = (s: Staff) => navigate(`/staff/${encodeURIComponent(s.staff_id)}`);

// The whole row opens the person (hand-off 01b-S01); its buttons and links keep their own action.
function onRow(s: Staff) {
  return (event: MouseEvent<HTMLLIElement>) => {
    if ((event.target as HTMLElement).closest('a, button, input, select, label') !== null) return;
    open(s);
  };
}

function StaffHead() {
  const head = [t('staff.col_name'), t('staff.col_roles'), t('staff.col_works_at'), t('staff.col_pin'), ''];
  return (
    <li className="pos-list__head">
      {head.map((cell, i) => (
        <span key={i}>{cell}</span>
      ))}
    </li>
  );
}

function PinButton({ s, down, primary = false, onPin }: { s: Staff; down: boolean; primary?: boolean; onPin: (staff: Staff) => void }) {
  return (
    <button type="button" className={`pos-btn${primary ? ' pos-btn--primary' : ''}`} disabled={down} onClick={() => onPin(s)}>
      <Icon name="lock" />
      {s.has_pin ? t('staff.reset_pin') : t('staff.set_pin')}
    </button>
  );
}

function PinState({ s }: { s: Staff }) {
  if (!s.is_active) {
    return s.left_at === null ? null : (
      <span className="pos-chip pos-chip--info">
        <Icon name="x" />
        {fill(t('staff.left_on'), { date: shortDate(s.left_at) })}
      </span>
    );
  }
  if (s.has_pin) {
    // "Since {date}" is the chip's tooltip and part of its accessible name.
    const since = s.pin_set_at === null ? null : fill(t('staff.pin_since'), { date: shortDate(s.pin_set_at) });
    return since === null ? (
      <Chip tone="ok">{t('staff.pin_set')}</Chip>
    ) : (
      <span className="pos-chip pos-chip--ok" title={since} role="img" aria-label={fill(t('staff.pin_chip'), { state: t('staff.pin_set'), since })}>
        <Icon name="check" />
        {t('staff.pin_set')}
      </span>
    );
  }
  return (
    <>
      <Chip tone="warn" icon="alert">
        {t('staff.pin_not_set')}
      </Chip>
      <small>{t('staff.pin_not_set_help')}</small>
    </>
  );
}

function StaffRows({
  rows,
  roles,
  down,
  onPin,
  branchName,
}: {
  rows: readonly Staff[];
  roles: ReadonlyMap<string, Role>;
  down: boolean;
  onPin: (staff: Staff) => void;
  branchName: (id: string) => string;
}) {
  return (
    <ul className="pos-list pos-list--staff">
      <StaffHead />
      {rows.map((s) => (
        <li key={s.staff_id} className={`pos-list__row${s.is_active ? '' : ' is-muted'}`} onClick={onRow(s)}>
          <div className="pos-list__name">
            <strong>{s.display_name}</strong>
          </div>
          <div className="pos-list__tags">
            {roleNames(roles, s.role_ids).map((name) => (
              <Chip key={name}>{name}</Chip>
            ))}
          </div>
          <div className="pos-list__cell">{s.branch_ids.map(branchName).join(', ')}</div>
          <div className="pos-list__cell">
            <PinState s={s} />
          </div>
          <div className="pos-list__acts">
            {s.is_active && <PinButton s={s} down={down} onPin={onPin} />}
            <a className="pos-rowlink" href={`#/staff/${encodeURIComponent(s.staff_id)}`} aria-label={fill(t('staff.edit_row'), { name: s.display_name })}>
              <Icon name="forward" flip />
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Phone (StaffPhoneList, StaffPhone): one line per person, "roles · branches" under the name, Reset PIN at
// the end. The name is the link to the person; the rest of the row opens it too.
function PhoneRows({
  rows,
  roles,
  down,
  rush,
  onPin,
  branchName,
}: {
  rows: readonly Staff[];
  roles: ReadonlyMap<string, Role>;
  down: boolean;
  rush: boolean;
  onPin: (staff: Staff) => void;
  branchName: (id: string) => string;
}) {
  const first = rows.find((s) => s.is_active)?.staff_id;
  return (
    <ul className="pos-list pos-list--stack pos-list--staff-phone">
      {rows.map((s) => (
        <li key={s.staff_id} className={`pos-list__row${s.is_active ? '' : ' is-muted'}`} onClick={onRow(s)}>
          <div className="pos-prow">
            <a className="pos-list__name pos-staff__link" href={`#/staff/${encodeURIComponent(s.staff_id)}`}>
              <strong>{s.display_name}</strong>
              <span>{[...roleNames(roles, s.role_ids), s.branch_ids.map(branchName).join(', ')].join(' · ')}</span>
            </a>
            {s.is_active ? (
              <PinButton s={s} down={down} primary={rush && s.staff_id === first} onPin={onPin} />
            ) : (
              <PinState s={s} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
