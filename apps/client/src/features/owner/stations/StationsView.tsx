import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, CompletionMode, PatchStationBody, Point, Program, Station, StationType } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ConfirmDialog } from '../../../components/Dialog';
import { SavedChip, UndoChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { BlockedDialog, itemNames, usedEntity, usedIds, type InUse } from '../BlockedDialog';
import { useCloudDown } from '../cloud';
import { errorText, issueMessages } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { formatMinutes, parseMinutes } from '../minutes';
import { BranchSelect, Page } from '../Shell';
import { TimingFields, alternatesEdited, emptyAlternateIssues, timingFieldLabel, timingPatch, timingState, type OfferedStation } from './Timing';
import { AddStationDialog, COMPLETION_MODES, parseWhole, RecipeDialog, typeOptions } from './StationDialogs';

// §8.1 #/stations (01a-S04): one row per station with a summary; Edit opens it in place with its batch
// recipes; Save station sends one PATCH of the changed fields. A type change or an archive that items
// still use is refused (§6.9) and shows the items (S50 b). Recipes archive at once with Undo.
// Pulse (01a hand-off CHANGES §2): the open station is its own section; Archive {station} sits in its More
// menu, and once the items using it are known (a CONFIG_IN_USE answer) its head shows the hint "Used by {n}
// items" with their names in the tooltip and aria-label. Show archived is an app-bar More item.
type StationRow = Station & { programs: Program[] };

const MODE_SHORT: Record<CompletionMode, 'owner.stations.mode_two_tap_short' | 'owner.stations.mode_single_tap_short' | 'owner.stations.mode_auto_done_short'> = {
  two_tap: 'owner.stations.mode_two_tap_short',
  single_tap: 'owner.stations.mode_single_tap_short',
  auto_done: 'owner.stations.mode_auto_done_short',
};

function summary(station: Station): string {
  return [
    station.location_label,
    t(station.station_type === 'batch' ? 'owner.stations.cooks_batches' : 'owner.stations.cooks_each'),
    fill(t('owner.stations.at_a_time'), { n: String(station.capacity) }),
    t(MODE_SHORT[station.completion_mode]),
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

// A-9: the alternates a station can name are the branch's other active slot stations.
function offeredFor(stations: readonly StationRow[], selfId: string): OfferedStation[] {
  return stations
    .filter((s) => s.station_id !== selfId && s.archived_at === null && s.station_type === 'slot')
    .map((s) => ({ station_id: s.station_id, name: s.name }));
}

// 409 CONFIG_IN_USE names items (routes) or stations (alternates, A-9): name each from what is loaded.
async function usersOf(api: CloudAdmin, error: CloudError, ids: string[], stations: readonly { station_id: string; name: string }[]): Promise<InUse> {
  if (usedEntity(error) === 'station') {
    return { ids, names: ids.flatMap((id) => stations.find((s) => s.station_id === id)?.name ?? []), by: 'station' };
  }
  return itemNames(api, ids);
}

function editorKey(station: StationRow): string {
  return JSON.stringify({ ...station, programs: undefined });
}

// Closed stations show as list rows; the open one (one at a time) is its own section between them.
type Run = { kind: 'open'; station: StationRow } | { kind: 'rows'; stations: StationRow[] };

function runs(stations: readonly StationRow[], open: string | null): Run[] {
  const out: Run[] = [];
  for (const station of stations) {
    const last = out.at(-1);
    if (station.station_id === open && station.archived_at === null) out.push({ kind: 'open', station });
    else if (last?.kind === 'rows') last.stations.push(station);
    else out.push({ kind: 'rows', stations: [station] });
  }
  return out;
}

function StationEditor({
  api,
  branchId,
  station,
  typeLocked,
  onSaved,
  onClose,
  onTypeBlocked,
  onArchive,
  onAddRecipe,
  onEditRecipe,
  showArchived,
  inUse,
  chips,
  points,
  offered,
  allStations,
}: {
  api: CloudAdmin;
  branchId: string;
  station: StationRow;
  typeLocked: boolean;
  onSaved: () => void;
  onClose: () => void;
  onTypeBlocked: (inUse: InUse) => void;
  onArchive: () => void;
  onAddRecipe: () => void;
  onEditRecipe: (program: Program) => void;
  showArchived: boolean;
  inUse: InUse | undefined;
  chips: ReactNode;
  points: readonly Point[];
  offered: readonly OfferedStation[];
  allStations: readonly { station_id: string; name: string }[];
}) {
  const [name, setName] = useState(station.name);
  const [label, setLabel] = useState(station.location_label ?? '');
  const [type, setType] = useState<StationType>(station.station_type);
  const [capacity, setCapacity] = useState(String(station.capacity));
  const [freshness, setFreshness] = useState(formatMinutes(station.freshness_window_ms ?? 0));
  const [mode, setMode] = useState<CompletionMode>(station.completion_mode);
  const offeredIds = new Set(offered.map((s) => s.station_id));
  const [timing, setTiming] = useState(() => timingState(station, offeredIds));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const leave = useLeave();

  const patch: PatchStationBody = {};
  if (name.trim() !== station.name) patch.name = name.trim();
  if ((label.trim() === '' ? null : label.trim()) !== station.location_label) patch.location_label = label.trim() === '' ? null : label.trim();
  if (type !== station.station_type) patch.station_type = type;
  const capacityValue = parseWhole(capacity);
  if (capacityValue !== null && capacityValue !== station.capacity) patch.capacity = capacityValue;
  if (type === 'batch' && freshness !== formatMinutes(station.freshness_window_ms ?? 0)) {
    const ms = parseMinutes(freshness);
    if (ms !== null) patch.freshness_window_ms = ms;
  }
  if (mode !== station.completion_mode) patch.completion_mode = mode;
  const timingChanges = timingPatch(timing, station, type, offeredIds);
  if (timingChanges !== null) Object.assign(patch, timingChanges);
  // A saved alternate that is archived now is dropped from the form (CL-10); that alone is not an edit, but it
  // goes out with any other save so the cloud does not refuse the archived row.
  const alternatesDirty = alternatesEdited(timing, station, type, offeredIds);
  const changed = Object.keys(patch).filter((field) => field !== 'alternates' || alternatesDirty).map((field) => t((timingFieldLabel(field) ?? `owner.stations.field.${field}`) as Parameters<typeof t>[0]));
  useDirtyForm(changed.length === 0 ? null : { name: station.name, fields: changed });

  async function save() {
    if (capacityValue === null || name.trim() === '' || timingChanges === null || (type === 'batch' && parseMinutes(freshness) === null)) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    if (changed.length === 0) {
      onClose();
      return;
    }
    const empty = emptyAlternateIssues(timing, type, offeredIds);
    if (Object.keys(empty).length > 0) {
      setIssues(empty);
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    setIssues({});
    const result = await api.patchStation(branchId, station.station_id, patch);
    setBusy(false);
    if (result.ok) {
      onSaved();
      return;
    }
    const ids = usedIds(result.error);
    if (ids !== null && patch.station_type !== undefined) {
      setType(station.station_type);
      onTypeBlocked(await usersOf(api, result.error, ids, allStations));
      return;
    }
    setIssues(issueMessages(result.error));
    setError(errorText(result.error));
  }

  const programs = station.programs.filter((p) => showArchived || p.archived_at === null);

  return (
    <section className="pos-section pos-section--open" data-station-id={station.station_id}>
      <div className="pos-section__top">
        <div className="pos-section__head">
          <h2>{station.name}</h2>
          {inUse !== undefined && <UsedByHint inUse={inUse} />}
        </div>
        <div className="pos-section__tools">
          {chips}
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.close')}
          </button>
          <BusyButton busy={busy} disabled={down} onClick={() => void save()}>
            {t('owner.stations.save_station')}
          </BusyButton>
          <MoreMenu
            label={fill(t('common.more_for'), { name: station.name })}
            info={{
              title: `${station.name} · ${t(station.station_type === 'batch' ? 'owner.stations.cooks_batches' : 'owner.stations.cooks_each')}`,
              detail: t('stations.menu_info'),
            }}
            items={[
              {
                label: fill(t('stations.menu_archive'), { station: station.name }),
                icon: 'archive',
                danger: true,
                disabled: down,
                onSelect: onArchive,
              },
            ]}
          />
        </div>
      </div>
      {error !== null && <Banner tone="danger" text={error} />}
      <div className="pos-grid">
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.stations.station_name')}</span>
          <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.stations.location_label')}</span>
          <input className="pos-input" name="location_label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <div className="pos-field">
        <span className="pos-field__label">{t('owner.stations.type')}</span>
        <Segmented label={t('owner.stations.type')} options={typeOptions()} value={type} onChange={setType} locked={typeLocked} />
        {typeLocked && <span className="pos-field__help">{t('owner.stations.type_locked')}</span>}
      </div>
      <div className="pos-grid pos-grid--3">
        <label className="pos-field">
          <span className="pos-field__label">{t(type === 'batch' ? 'owner.stations.capacity_batch' : 'owner.stations.capacity')}</span>
          <input className="pos-input pos-input--mono" name="capacity" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        {type === 'batch' && (
          <label className="pos-field">
            <span className="pos-field__label">{t('owner.stations.freshness_minutes')}</span>
            <input
              className="pos-input pos-input--mono"
              name="freshness_minutes"
              inputMode="decimal"
              value={freshness}
              onChange={(e) => setFreshness(e.target.value)}
            />
          </label>
        )}
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.stations.completion_mode')}</span>
          <select className="pos-select" name="completion_mode" value={mode} onChange={(e) => setMode(e.target.value as CompletionMode)}>
            {COMPLETION_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TimingFields
        state={timing}
        onChange={setTiming}
        type={type}
        points={points}
        offered={offered}
        issues={issues}
        base={station}
        currentPointId={station.point_id}
      />
      {station.station_type === 'batch' && (
        <>
          <div className="pos-section__head pos-section__head--sub">
            <h3>{t('owner.stations.programs')}</h3>
            <p>{t('owner.stations.programs_body')}</p>
          </div>
          {programs.length > 0 && (
            <ul className="pos-list pos-list--programs">
              {programs.map((program) => (
                <li key={program.program_id} className={`pos-list__row${program.archived_at === null ? '' : ' is-muted'}`} data-program-id={program.program_id}>
                  <strong>{program.name}</strong>
                  <span className="pos-list__num">{fill(t('owner.stations.minutes_n'), { n: formatMinutes(program.cook_time_ms) })}</span>
                  <button type="button" className="pos-btn" onClick={() => onEditRecipe(program)}>
                    {t(program.archived_at === null ? 'owner.common.edit' : 'owner.common.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="pos-btn pos-btn--start" onClick={onAddRecipe}>
            <Icon name="plus" />
            {t('owner.stations.add_program')}
          </button>
        </>
      )}
    </section>
  );
}

// The items known to use a station (from a CONFIG_IN_USE answer): a hint whose tooltip and accessible
// name list them (01a hand-off CHANGES §2, S04).
function UsedByHint({ inUse }: { inUse: InUse }) {
  const n = String(inUse.ids.length);
  const more = inUse.ids.length - inUse.names.length;
  const names = [...inUse.names, ...(more > 0 ? [fill(t('archive.and_more'), { n: String(more) })] : [])].join(', ');
  return (
    <button
      type="button"
      className="pos-hint"
      title={names}
      aria-label={fill(t(inUse.by === 'station' ? 'stations.used_by_stations_names' : 'stations.used_by_names'), { n, names })}
    >
      <Icon name="info" />
      {fill(t(inUse.by === 'station' ? 'stations.used_by_stations_short' : 'stations.used_by_short'), { n })}
    </button>
  );
}

type Ask =
  | { kind: 'archive'; station: StationRow }
  | { kind: 'blocked'; station: StationRow; inUse: InUse; type: boolean }
  | { kind: 'recipe'; station: StationRow; program: Program | null }
  | null;

export function StationsView({
  api,
  branchId,
  branchIds = [branchId],
  onBranch = () => {},
}: {
  api: CloudAdmin;
  branchId: string;
  branchIds?: readonly string[];
  onBranch?: (branchId: string) => void;
}) {
  const branchName = useBranchName();
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [typeLocked, setTypeLocked] = useState<Set<string>>(new Set());
  // Items a CONFIG_IN_USE answer named for a station (its archive or type change): the "Used by" hint.
  const [usedBy, setUsedBy] = useState<ReadonlyMap<string, InUse>>(new Map());
  const [undo, setUndo] = useState<{ stationId: string; program: Program } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const down = useCloudDown(api);
  const leave = useLeave();

  const load = useCallback(async () => {
    const result = await api.listStations(branchId);
    if (result.ok) {
      setStations(result.data.stations);
      setPoints(result.data.points);
      setError(null);
    } else setError(errorText(result.error));
  }, [api, branchId]);

  useEffect(() => {
    setStations(null);
    setOpen(null);
    void load();
  }, [load]);

  const wasDown = useRef(down);
  useEffect(() => {
    if (wasDown.current && !down && stations === null) void load();
    wasDown.current = down;
  }, [down, stations, load]);

  function flashSaved(id: string) {
    setSavedId(id);
    saved.flash();
  }

  async function setProgramArchived(stationId: string, program: Program, archived: boolean) {
    const result = await api.patchProgram(branchId, stationId, program.program_id, { archived });
    if (!result.ok) {
      const ids = usedIds(result.error);
      const station = stations?.find((s) => s.station_id === stationId);
      if (ids !== null && station !== undefined) setAsk({ kind: 'blocked', station, inUse: await usersOf(api, result.error, ids, stations ?? []), type: false });
      else setError(errorText(result.error));
    } else if (archived) setUndo({ stationId, program });
    else setUndo(null);
    await load();
  }

  async function archiveStation(station: StationRow) {
    setAsk(null);
    const result = await api.patchStation(branchId, station.station_id, { archived: true });
    if (!result.ok) {
      const ids = usedIds(result.error);
      if (ids !== null) {
        const inUse = await usersOf(api, result.error, ids, stations ?? []);
        setUsedBy((known) => new Map(known).set(station.station_id, inUse));
        setAsk({ kind: 'blocked', station, inUse, type: false });
      } else setError(errorText(result.error));
    } else setOpen(null);
    await load();
  }

  async function restoreStation(station: StationRow) {
    const result = await api.patchStation(branchId, station.station_id, { archived: false });
    if (!result.ok) setError(errorText(result.error));
    else flashSaved(station.station_id);
    await load();
  }

  const visible = (row: { archived_at: number | null }) => showArchived || row.archived_at === null;

  const chips = (id: string) => (
    <>
      <SavedChip shown={saved.shown && savedId === id} />
      {undo?.stationId === id && (
        <UndoChip paused={down} onUndo={() => void setProgramArchived(id, undo.program, false)} onDone={() => setUndo(null)} />
      )}
    </>
  );

  return (
    <Page
      api={api}
      title={t('owner.stations.title')}
      after={<BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />}
      end={
        <>
          {showArchived && (
            <button
              type="button"
              className="pos-filterchip"
              aria-label={t('stations.hide_archived')}
              onClick={() => setShowArchived(false)}
            >
              <Icon name="archive" />
              {t('floors.archived_shown')}
              <Icon name="x" />
            </button>
          )}
          <MoreMenu
            label={t('owner.stations.more')}
            items={[
              {
                label: t(showArchived ? 'stations.hide_archived' : 'owner.common.show_archived'),
                icon: 'archive',
                onSelect: () => setShowArchived(!showArchived),
              },
            ]}
          />
          <button type="button" className="pos-btn pos-btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t('owner.stations.add_station')}
          </button>
        </>
      }
    >
      {error !== null && <Banner tone="danger" text={error} />}
      {stations === null && <Skeleton lines={4} />}
      {stations !== null &&
        runs(stations.filter(visible), open).map((run) =>
          run.kind === 'open' ? (
            <StationEditor
              key={editorKey(run.station)}
              api={api}
              branchId={branchId}
              station={run.station}
              showArchived={showArchived}
              typeLocked={typeLocked.has(run.station.station_id)}
              inUse={usedBy.get(run.station.station_id)}
              chips={chips(run.station.station_id)}
              points={points}
              offered={offeredFor(stations, run.station.station_id)}
              allStations={stations}
              onSaved={() => {
                setOpen(null);
                flashSaved(run.station.station_id);
                void load();
              }}
              onClose={() => setOpen(null)}
              onTypeBlocked={(inUse) => {
                const station = run.station;
                setTypeLocked(new Set([...typeLocked, station.station_id]));
                setUsedBy((known) => new Map(known).set(station.station_id, inUse));
                setAsk({ kind: 'blocked', station, inUse, type: true });
              }}
              onArchive={() => setAsk({ kind: 'archive', station: run.station })}
              onAddRecipe={() => setAsk({ kind: 'recipe', station: run.station, program: null })}
              onEditRecipe={(program) =>
                program.archived_at === null
                  ? setAsk({ kind: 'recipe', station: run.station, program })
                  : void setProgramArchived(run.station.station_id, program, false)
              }
            />
          ) : (
            <ul key={run.stations[0]?.station_id} className="pos-list pos-list--stations">
              {run.stations.map((station) => {
                const id = station.station_id;
                const archived = station.archived_at !== null;
                return (
                  <li key={id} className={`pos-list__row${archived ? ' is-muted' : ''}`} data-station-id={id}>
                    <span className="pos-list__name">
                      <strong>{station.name}</strong>
                      <span>{summary(station)}</span>
                    </span>
                    <div className="pos-section__tools">
                      {chips(id)}
                      {archived ? (
                        <button type="button" className="pos-btn" disabled={down} onClick={() => void restoreStation(station)}>
                          {t('owner.common.restore')}
                        </button>
                      ) : (
                        <button type="button" className="pos-btn" onClick={() => setOpen(id)}>
                          {t('owner.common.edit')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ),
        )}

      {adding && (
        <AddStationDialog
          api={api}
          branchId={branchId}
          onClose={() => setAdding(false)}
          onMismatch={() => void load()}
          onCreated={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {ask?.kind === 'recipe' && (
        <RecipeDialog
          api={api}
          branchId={branchId}
          stationId={ask.station.station_id}
          stationName={ask.station.name}
          program={ask.program}
          onClose={() => setAsk(null)}
          onMismatch={() => void load()}
          onSaved={() => {
            flashSaved(ask.station.station_id);
            setAsk(null);
            void load();
          }}
          onArchive={() => {
            const { station, program } = ask;
            setAsk(null);
            if (program !== null) void setProgramArchived(station.station_id, program, true);
          }}
        />
      )}
      {ask?.kind === 'archive' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.station.name })}
          body={t('archive.station_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.station.name })}
          tone="danger"
          onConfirm={() => void archiveStation(ask.station)}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'blocked' && (
        <BlockedDialog
          title={fill(t(ask.type ? 'archive.station_type_blocked' : 'archive.blocked_title'), { name: ask.station.name })}
          body={fill(t(ask.inUse.by === 'station' ? 'archive.station_blocked_by_stations' : 'archive.station_blocked_body'), {
            n: String(ask.inUse.ids.length),
            branch: branchName(branchId),
          })}
          inUse={ask.inUse}
          onClose={() => setAsk(null)}
          action={
            ask.inUse.by === 'station' ? undefined : (
              <button type="button" className="pos-btn pos-btn--primary" onClick={() => leave(() => navigate('/menu'))}>
                {t('archive.open_items')}
              </button>
            )
          }
        />
      )}
    </Page>
  );
}
