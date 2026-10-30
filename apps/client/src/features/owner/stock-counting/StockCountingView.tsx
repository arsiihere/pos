import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePhone } from '../../../app/phone';
import type { CloudAdmin, ResponsibilitySet, Role, Staff, Station } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { ListRow } from '../../../components/List';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { useDirtyForm } from '../guard';
import { BranchSelect, Page, PeopleTabs } from '../Shell';

// 01b §8 #/stock-counting (01b-S05, §6.8): who counts stock at each active station of the branch. Change
// picks people (who work at the branch) and roles per station; Save sends the whole active set with the
// held `expected_version` (a station with nobody is left out: it stores nothing, AD-19). CONFIG_STALE
// shows "Changed elsewhere": the picks stay until Reload, which reads the current set (owner decision
// 2026-10-30, 01b proposal P1; same as 01c §8); a 422 means a person, role or station changed meanwhile.
// Pulse (hand-off 01b-S05): people / role chips with their icons, a "Nobody yet" warn chip per station and
// one summary warn banner, the help line as a small note. While Reload shows, Save is disabled and not
// primary (B03: Reload is the one primary). Phone: branch select in the content, stacked rows, Save in the
// bottom action bar (ResponsibilitiesPhone).
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
  const phone = usePhone();

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

  const reloading = notice === 'stale' || notice === 'changed';
  const select = <BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />;
  const saveButton = (
    <BusyButton primary={!reloading} size={phone ? 'lg block' : undefined} busy={busy} disabled={down || changed.length === 0 || reloading} onClick={() => void save()}>
      {t('counting.save')}
    </BusyButton>
  );
  const actions = phone ? undefined : (
    <>
      {select}
      {saveButton}
    </>
  );

  const reload = (
    <div className="pos-banner__action pos-row">
      <button type="button" className="pos-btn pos-btn--primary" onClick={() => { setNotice(null); void load(); }}>
        <Icon name="reload" />
        {t('staff.reload')}
      </button>
    </div>
  );

  let body;
  if (loaded === null) {
    body = loadError === null ? <Skeleton lines={5} /> : null;
  } else if (loaded.stations.length === 0) {
    body = (
      <EmptyState card icon="flame" title={fill(t('counting.no_stations'), { branch })} body={t('counting.no_stations_body')}>
        <button type="button" className="pos-btn" onClick={() => navigate('/stations')}>
          <Icon name="forward" flip />
          {t('counting.open_stations')}
        </button>
      </EmptyState>
    );
  } else {
    const nobody = loaded.stations.filter((s) => {
      const e = draft[s.station_id];
      return e === undefined || (e.staff_ids.length === 0 && e.role_ids.length === 0);
    });
    const rows = loaded.stations.map((s) => {
      const entry = draft[s.station_id];
      const people = (entry?.staff_ids ?? []).map((id) => staffById.get(id)?.display_name ?? id);
      const roles = (entry?.role_ids ?? []).map((id) => roleById.get(id)?.name ?? id);
      const name = (
        <div className="pos-list__name">
          <strong>{s.name}</strong>
          <div className="pos-list__tags">
            {people.map((who) => (
              <Chip key={`s-${who}`} icon="user">
                {who}
              </Chip>
            ))}
            {roles.map((role) => (
              <Chip key={`r-${role}`} tone="accent" icon="shield">
                {fill(t('counting.everyone_with'), { role })}
              </Chip>
            ))}
            {people.length === 0 && roles.length === 0 && (
              <Chip tone="warn" icon="alert">
                {t('counting.nobody')}
              </Chip>
            )}
          </div>
        </div>
      );
      const change = (
        <button type="button" className="pos-btn" disabled={down} onClick={() => setPicking(s)}>
          {t('counting.change')}
        </button>
      );
      return (
        <ListRow key={s.station_id} touched={changed.includes(s)}>
          {phone ? (
            <div className="pos-prow">
              {name}
              {change}
            </div>
          ) : (
            <>
              {name}
              <div className="pos-list__side">{change}</div>
            </>
          )}
        </ListRow>
      );
    });
    body = (
      <>
        <ul className={`pos-list ${phone ? 'pos-list--stack' : 'pos-list--rows'}`}>{rows}</ul>
        {/* One summary banner for every station nobody counts (hand-off: "one summary warn banner"). */}
        {nobody.length > 0 && (
          <Banner
            tone="warn"
            icon="alert"
            text={fill(t('counting.nobody_counts'), { station: nobody.map((s) => s.name).join(', '), branch })}
            detail={t('counting.nobody_counts_body')}
          />
        )}
      </>
    );
  }

  return (
    <Page api={api} title={t('counting.title')} end={actions}>
      <PeopleTabs current="counting" />
      {phone && <div className="pos-branchpick">{select}</div>}
      {loadError !== null && <Banner tone="danger" text={loadError} />}
      {notice === 'saved' && <Banner tone="ok" text={fill(t('counting.saved'), { branch })} />}
      {notice === 'stale' && (
        <StaleBanner
          onReload={() => {
            setNotice(null);
            void load();
          }}
        />
      )}
      {notice === 'changed' && (
        <div className="pos-banner pos-banner--danger" role="alert">
          <Icon name="alert" />
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
      {!phone && <p className={`${typeClass('body')} pos-intro`}>{t('counting.intro')}</p>}
      {body}
      {!phone && (
        <p className="pos-note pos-note--icon">
          <Icon name="info" />
          <span>{t('counting.explain')}</span>
        </p>
      )}
      {phone && (
        <div className="pos-pagebar">
          <ActionBar>{saveButton}</ActionBar>
        </div>
      )}
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
            <Icon name="check" />
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
              {picked.staff_ids.includes(s.staff_id) && <Icon name="check" />}
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
              {picked.role_ids.includes(r.role_id) && <Icon name="check" />}
              {r.name}
            </button>
          ))}
        </div>
        <span className="pos-field__help">{fill(t('counting.roles_help'), { branch })}</span>
      </div>
    </Dialog>
  );
}
