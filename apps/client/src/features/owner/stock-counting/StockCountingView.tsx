import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudAdmin, ResponsibilitySet, Role, Staff, Station } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { ListRow } from '../../../components/List';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { useDirtyForm } from '../guard';
import { BranchSelect, Page } from '../Shell';

// 01b §8 #/stock-counting (01b-S05, §6.8): who counts stock at each active station of the branch. Change
// picks people (who work at the branch) and roles per station; Save sends the whole active set with the
// held `expected_version` (a station with nobody is left out: it stores nothing, AD-19). CONFIG_STALE
// shows Reload; a 422 means a person, role or station changed meanwhile.
interface Entry {
  staff_ids: string[];
  role_ids: string[];
}

interface Loaded {
  version: string;
  stations: Station[];
  staff: Staff[];
  roles: Role[];
  stored: Record<string, Entry>;
}

type Notice = 'saved' | 'stale' | 'changed' | { error: string } | null;

function entriesOf(set: ResponsibilitySet): Record<string, Entry> {
  return Object.fromEntries(set.responsibilities.map((r) => [r.station_id, { staff_ids: [...r.staff_ids], role_ids: [...r.role_ids] }]));
}

const sameEntry = (a: Entry | undefined, b: Entry | undefined) =>
  JSON.stringify([[...(a?.staff_ids ?? [])].sort(), [...(a?.role_ids ?? [])].sort()]) ===
  JSON.stringify([[...(b?.staff_ids ?? [])].sort(), [...(b?.role_ids ?? [])].sort()]);

export function StockCountingView({
  api,
  branchId,
  branchIds,
  onBranch,
}: {
  api: CloudAdmin;
  branchId: string;
  branchIds: readonly string[];
  onBranch: (branchId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Record<string, Entry>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [picking, setPicking] = useState<Station | null>(null);
  const [busy, setBusy] = useState(false);
  const down = useCloudDown(api);
  const branchName = useBranchName();
  const branch = branchName(branchId);

  const load = useCallback(async () => {
    setLoaded(null);
    const [set, stations, staff, roles] = await Promise.all([
      api.getResponsibilities(branchId),
      api.listStations(branchId),
      api.listStaff({ branch_id: branchId }),
      api.listRoles(),
    ]);
    if (set.ok && stations.ok && staff.ok && roles.ok) {
      const stored = entriesOf(set.data);
      setLoaded({
        version: set.data.version,
        stations: stations.data.stations.filter((s) => s.archived_at === null),
        staff: staff.data.staff,
        roles: roles.data.roles,
        stored,
      });
      setDraft(stored);
      setLoadError(null);
      return;
    }
    const failed = [set, stations, staff, roles].find((r) => !r.ok);
    if (failed !== undefined && !failed.ok) setLoadError(errorText(failed.error));
  }, [api, branchId]);

  useEffect(() => {
    setNotice(null);
    void load();
  }, [load]);

  const staffById = useMemo(() => new Map((loaded?.staff ?? []).map((s) => [s.staff_id, s])), [loaded]);
  const roleById = useMemo(() => new Map((loaded?.roles ?? []).map((r) => [r.role_id, r])), [loaded]);
  const changed = loaded === null ? [] : loaded.stations.filter((s) => !sameEntry(draft[s.station_id], loaded.stored[s.station_id]));
  useDirtyForm(changed.length === 0 ? null : { name: t('counting.title'), fields: changed.map((s) => s.name) });

  async function save() {
    if (loaded === null) return;
    setBusy(true);
    const responsibilities = loaded.stations.flatMap((s) => {
      const entry = draft[s.station_id];
      if (entry === undefined || (entry.staff_ids.length === 0 && entry.role_ids.length === 0)) return [];
      return [{ responsibility: 'count_stock' as const, station_id: s.station_id, staff_ids: entry.staff_ids, role_ids: entry.role_ids }];
    });
    const result = await api.putResponsibilities(branchId, { expected_version: loaded.version, responsibilities });
    setBusy(false);
    if (result.ok) {
      const stored = entriesOf(result.data);
      setLoaded({ ...loaded, version: result.data.version, stored });
      setDraft(stored);
      setNotice('saved');
      return;
    }
    const error = result.error;
    if (error.kind === 'api' && error.code === 'CONFIG_STALE') setNotice('stale');
    else if (error.kind === 'api' && error.code === 'CONFIG_REFERENCE_INVALID') setNotice('changed');
    else setNotice({ error: errorText(error) ?? '' });
  }

  const actions = (
    <>
      <BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />
      <BusyButton primary busy={busy} disabled={down || changed.length === 0 || notice === 'stale' || notice === 'changed'} onClick={() => void save()}>
        {t('counting.save')}
      </BusyButton>
    </>
  );

  const reload = (
    <div className="pos-banner__action pos-row">
      <button type="button" className="pos-btn pos-btn--primary" onClick={() => { setNotice(null); void load(); }}>
        {t('staff.reload')}
      </button>
    </div>
  );

  let body;
  if (loaded === null) {
    body = loadError === null ? <Skeleton lines={5} /> : null;
  } else if (loaded.stations.length === 0) {
    body = (
      <div className="pos-empty pos-card">
        <h3>{fill(t('counting.no_stations'), { branch })}</h3>
        <p>{t('counting.no_stations_body')}</p>
        <button type="button" className="pos-btn pos-btn--primary" onClick={() => navigate('/stations')}>
          {t('counting.open_stations')}
        </button>
      </div>
    );
  } else {
    const nobody = loaded.stations.filter((s) => {
      const e = draft[s.station_id];
      return e === undefined || (e.staff_ids.length === 0 && e.role_ids.length === 0);
    });
    body = (
      <>
        <ul className="pos-list pos-list--rows">
          {loaded.stations.map((s) => {
            const entry = draft[s.station_id];
            const people = (entry?.staff_ids ?? []).map((id) => staffById.get(id)?.display_name ?? id);
            const roles = (entry?.role_ids ?? []).map((id) => roleById.get(id)?.name ?? id);
            return (
              <ListRow key={s.station_id} touched={changed.includes(s)}>
                <div className="pos-list__name">
                  <strong>{s.name}</strong>
                  <div className="pos-list__tags">
                    {people.map((name) => (
                      <Chip key={`s-${name}`}>{name}</Chip>
                    ))}
                    {roles.map((name) => (
                      <Chip key={`r-${name}`} tone="accent">
                        {fill(t('counting.everyone_with'), { role: name })}
                      </Chip>
                    ))}
                    {people.length === 0 && roles.length === 0 && <Chip tone="warn">{t('counting.nobody')}</Chip>}
                  </div>
                </div>
                <div className="pos-list__side">
                  <button type="button" className="pos-btn" disabled={down} onClick={() => setPicking(s)}>
                    {t('counting.change')}
                  </button>
                </div>
              </ListRow>
            );
          })}
        </ul>
        {nobody.map((s) => (
          <Banner key={s.station_id} tone="warn" text={fill(t('counting.nobody_counts'), { station: s.name, branch })} detail={t('counting.nobody_counts_body')} />
        ))}
      </>
    );
  }

  return (
    <Page api={api} title={t('counting.title')} end={actions}>
      {loadError !== null && <Banner tone="danger" text={loadError} />}
      {notice === 'saved' && <Banner tone="ok" text={fill(t('counting.saved'), { branch })} />}
      {notice === 'stale' && (
        <div className="pos-banner pos-banner--warn" role="status">
          <p>
            {t('errors.CONFIG_STALE')}
            <small>{t('staff.stale_body')}</small>
          </p>
          {reload}
        </div>
      )}
      {notice === 'changed' && (
        <div className="pos-banner pos-banner--warn" role="status">
          <p>
            {t('counting.changed')}
            <small>{fill(t('counting.changed_body'), { branch })}</small>
          </p>
          {reload}
        </div>
      )}
      {notice !== null && typeof notice === 'object' && <Banner tone="danger" text={notice.error} />}
      {changed.length > 0 && notice === null && (
        <Banner
          tone="info"
          text={changed.length === 1 ? t('counting.unsaved_one') : fill(t('counting.unsaved'), { n: String(changed.length) })}
          detail={fill(t('counting.unsaved_body'), { branch })}
        />
      )}
      <p className={typeClass('body')}>{t('counting.intro')}</p>
      {body}
      <div className="pos-explain">
        <span>{t('counting.explain')}</span>
      </div>
      {picking !== null && loaded !== null && (
        <Picker
          station={picking}
          branch={branch}
          staff={loaded.staff.filter((s) => s.is_active)}
          roles={loaded.roles.filter((r) => r.archived_at === null)}
          entry={draft[picking.station_id] ?? { staff_ids: [], role_ids: [] }}
          onDone={(entry) => {
            setDraft((prev) => ({ ...prev, [picking.station_id]: entry }));
            if (notice === 'saved') setNotice(null);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Page>
  );
}

function Picker({
  station,
  branch,
  staff,
  roles,
  entry,
  onDone,
  onClose,
}: {
  station: Station;
  branch: string;
  staff: readonly Staff[];
  roles: readonly Role[];
  entry: Entry;
  onDone: (entry: Entry) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Entry>(entry);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Dialog
      title={fill(t('counting.picker_title'), { station: station.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary" onClick={() => onDone(picked)}>
            {t('counting.done')}
          </button>
        </>
      }
    >
      <p className="pos-dialog__body">{branch}</p>
      <div className="pos-field">
        <span className="pos-field__label">{fill(t('counting.people_at'), { branch })}</span>
        <div className="pos-row" role="group" aria-label={fill(t('counting.people_at'), { branch })}>
          {staff.map((s) => (
            <button
              key={s.staff_id}
              type="button"
              className="pos-chip"
              aria-pressed={picked.staff_ids.includes(s.staff_id)}
              onClick={() => setPicked({ ...picked, staff_ids: flip(picked.staff_ids, s.staff_id) })}
            >
              {s.display_name}
            </button>
          ))}
        </div>
      </div>
      <div className="pos-field">
        <span className="pos-field__label">{t('counting.roles')}</span>
        <div className="pos-row" role="group" aria-label={t('counting.roles')}>
          {roles.map((r) => (
            <button
              key={r.role_id}
              type="button"
              className="pos-chip"
              aria-pressed={picked.role_ids.includes(r.role_id)}
              onClick={() => setPicked({ ...picked, role_ids: flip(picked.role_ids, r.role_id) })}
            >
              {r.name}
            </button>
          ))}
        </div>
        <span className="pos-field__help">{fill(t('counting.roles_help'), { branch })}</span>
      </div>
    </Dialog>
  );
}
