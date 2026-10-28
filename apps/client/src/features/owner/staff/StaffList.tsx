import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudAdmin, Role, Staff } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { ListRow } from '../../../components/List';
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
// client-side name search (§6.1: no `q`). Reset PIN opens D01 in place; Edit opens #/staff/:id.
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

  const add = (
    <button type="button" className="pos-btn pos-btn--primary" disabled={down} onClick={() => navigate('/staff/new')}>
      <Icon name="plus" />
      {t('staff.add')}
    </button>
  );

  let body;
  if (lists === null) {
    body = error === null ? <Skeleton lines={6} /> : null;
  } else if (lists.active.length === 0 && lists.left.length === 0) {
    const active = lists.roles.filter((r) => r.archived_at === null);
    body = (
      <div className="pos-empty pos-card">
        <h3>{t('staff.empty_title')}</h3>
        <p className={typeClass('body')}>{t('staff.empty_body')}</p>
        <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" disabled={down} onClick={() => navigate('/staff/new')}>
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
        <div className="pos-row">
          <div className="pos-row">
            <label className="pos-input-affix">
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
              <select className="pos-select" aria-label={t('owner.branch')} value={branch} onChange={(e) => setBranch(e.target.value)}>
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
            options={[
              { value: 'active', label: t('staff.working'), count: lists.active.length },
              { value: 'left', label: t('staff.left'), count: lists.left.length },
            ]}
          />
        </div>
        {shown.length === 0 ? (
          needle !== '' ? (
            <EmptyState title={fill(t('staff.no_match'), { q: query.trim() })} body={t('staff.no_match_body')} />
          ) : branch !== '' && status === 'active' ? (
            <EmptyState title={fill(t('staff.branch_empty'), { branch: branchName(branch) })} body={t('staff.branch_empty_body')} />
          ) : (
            <EmptyState title={t('staff.left_empty')} />
          )
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
  const head = [t('staff.col_name'), t('staff.col_roles'), t('staff.col_works_at'), t('staff.col_pin'), ''];
  return (
    <ul className="pos-list pos-list--staff">
      <li className="pos-list__head">
        {head.map((cell, i) => (
          <span key={i}>{cell}</span>
        ))}
      </li>
      {rows.map((s) => (
        <ListRow key={s.staff_id} muted={!s.is_active}>
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
            {!s.is_active ? (
              <small>{s.left_at === null ? '' : fill(t('staff.left_on'), { date: shortDate(s.left_at) })}</small>
            ) : s.has_pin ? (
              <>
                <Chip tone="ok">{t('staff.pin_set')}</Chip>
                {s.pin_set_at !== null && <small>{fill(t('staff.pin_since'), { date: shortDate(s.pin_set_at) })}</small>}
              </>
            ) : (
              <>
                <Chip tone="warn">{t('staff.pin_not_set')}</Chip>
                <small>{t('staff.pin_not_set_help')}</small>
              </>
            )}
          </div>
          <div className="pos-list__acts">
            {s.is_active && (
              <button type="button" className="pos-btn" disabled={down} onClick={() => onPin(s)}>
                <Icon name="key" />
                {s.has_pin ? t('staff.reset_pin') : t('staff.set_pin')}
              </button>
            )}
            <button type="button" className="pos-btn" onClick={() => navigate(`/staff/${encodeURIComponent(s.staff_id)}`)}>
              {t('staff.edit')}
            </button>
          </div>
        </ListRow>
      ))}
    </ul>
  );
}
