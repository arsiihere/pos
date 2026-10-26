import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudAdmin, CompletionMode, PatchStationBody, Program, Station, StationType } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ConfirmDialog } from '../../../components/Dialog';
import { SavedChip, UndoChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { List, ListRow } from '../../../components/List';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { idTail } from '../branch';
import { BlockedDialog, itemNames, usedIds, type InUse } from '../BlockedDialog';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { formatMinutes, parseMinutes } from '../minutes';
import { BranchSelect, Page } from '../Shell';
import { AddStationDialog, COMPLETION_MODES, parseWhole, RecipeDialog, typeOptions } from './StationDialogs';

// §8.1 #/stations (01a-S04): one row per station with a summary; Edit opens it in place with its batch
// recipes; Save station sends one PATCH of the changed fields. A type change or an archive that items
// still use is refused (§6.9) and shows the items (S50 b). Recipes archive at once with Undo.
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
}) {
  const [name, setName] = useState(station.name);
  const [label, setLabel] = useState(station.location_label ?? '');
  const [type, setType] = useState<StationType>(station.station_type);
  const [capacity, setCapacity] = useState(String(station.capacity));
  const [freshness, setFreshness] = useState(formatMinutes(station.freshness_window_ms ?? 0));
  const [mode, setMode] = useState<CompletionMode>(station.completion_mode);
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
  const changed = Object.keys(patch).map((field) => t(`owner.stations.field.${field}` as Parameters<typeof t>[0]));
  useDirtyForm(changed.length === 0 ? null : { name: station.name, fields: changed });

  async function save() {
    if (capacityValue === null || name.trim() === '' || (type === 'batch' && parseMinutes(freshness) === null)) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    if (changed.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.patchStation(branchId, station.station_id, patch);
    setBusy(false);
    if (result.ok) {
      onSaved();
      return;
    }
    const ids = usedIds(result.error);
    if (ids !== null && patch.station_type !== undefined) {
      setType(station.station_type);
      onTypeBlocked(await itemNames(api, ids));
      return;
    }
    setError(errorText(result.error));
  }

  const programs = station.programs.filter((p) => showArchived || p.archived_at === null);

  return (
    <div className="pos-section">
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.station_name')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.location_label')}</span>
        <input className="pos-input" name="location_label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="pos-field">
        <span className="pos-field__label">{t('owner.stations.type')}</span>
        {typeLocked ? (
          <>
            <p className={typeClass('body')}>{t(type === 'batch' ? 'owner.stations.type_batch' : 'owner.stations.type_slot')}</p>
            <span className="pos-field__help">{t('owner.stations.type_locked')}</span>
          </>
        ) : (
          <Segmented label={t('owner.stations.type')} options={typeOptions()} value={type} onChange={setType} />
        )}
      </div>
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
      {station.station_type === 'batch' && (
        <div className="pos-stack">
          <div className="pos-section__head">
            <h2>{t('owner.stations.programs')}</h2>
            <p>{t('owner.stations.programs_body')}</p>
          </div>
          <ul className="pos-list">
            {programs.map((program) => (
              <li key={program.program_id} className={`pos-list__row${program.archived_at === null ? '' : ' is-muted'}`} data-program-id={program.program_id}>
                <span className="pos-list__name">
                  <strong>{program.name}</strong>
                  <span className="pos-ltr">{fill(t('owner.stations.minutes_n'), { n: formatMinutes(program.cook_time_ms) })}</span>
                </span>
                <button type="button" className="pos-btn" onClick={() => onEditRecipe(program)}>
                  {t(program.archived_at === null ? 'owner.common.edit' : 'owner.common.restore')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="pos-btn" onClick={onAddRecipe}>
            <Icon name="plus" />
            {t('owner.stations.add_program')}
          </button>
        </div>
      )}
      <div className="pos-dialog__danger">
        <strong>{t('owner.stations.archive_station')}</strong>
        <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={onArchive}>
          {t('owner.common.archive')}
        </button>
      </div>
      {error !== null && <Banner tone="danger" text={error} />}
      <div className="pos-dialog__footer">
        <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
          {t('common.close')}
        </button>
        <BusyButton busy={busy} primary disabled={down} onClick={() => void save()}>
          {t('owner.stations.save_station')}
        </BusyButton>
      </div>
    </div>
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
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [typeLocked, setTypeLocked] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ stationId: string; program: Program } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const down = useCloudDown(api);
  const leave = useLeave();

  const load = useCallback(async () => {
    const result = await api.listStations(branchId);
    if (result.ok) {
      setStations(result.data.stations);
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
      if (ids !== null && station !== undefined) setAsk({ kind: 'blocked', station, inUse: await itemNames(api, ids), type: false });
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
      if (ids !== null) setAsk({ kind: 'blocked', station, inUse: await itemNames(api, ids), type: false });
      else setError(errorText(result.error));
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

  return (
    <Page
      api={api}
      title={t('owner.stations.title')}
      after={<BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />}
      end={
        <>
          <Switch checked={showArchived} label={t('owner.common.show_archived')} onChange={setShowArchived} />
          <button type="button" className="pos-btn pos-btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t('owner.stations.add_station')}
          </button>
        </>
      }
    >
      {error !== null && <Banner tone="danger" text={error} />}
      {stations === null && <Skeleton lines={4} />}
      {stations !== null && (
        <List preset="stack">
          {stations.filter(visible).map((station) => {
            const id = station.station_id;
            const archived = station.archived_at !== null;
            return (
              <ListRow key={id} muted={archived}>
                <div className="pos-stack" data-station-id={id}>
                  <div className="pos-row">
                    <span className="pos-list__name">
                      <strong>{station.name}</strong>
                      <span>{summary(station)}</span>
                    </span>
                    <SavedChip shown={saved.shown && savedId === id} />
                    {undo?.stationId === id && (
                      <UndoChip
                        paused={down}
                        onUndo={() => void setProgramArchived(id, undo.program, false)}
                        onDone={() => setUndo(null)}
                      />
                    )}
                    <div className="pos-appbar__end">
                      {archived ? (
                        <button type="button" className="pos-btn" disabled={down} onClick={() => void restoreStation(station)}>
                          {t('owner.common.restore')}
                        </button>
                      ) : (
                        open !== id && (
                          <button type="button" className="pos-btn" onClick={() => setOpen(id)}>
                            {t('owner.common.edit')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {open === id && !archived && (
                    <StationEditor
                      key={`${id}-${station.name}-${station.station_type}-${station.capacity}-${station.completion_mode}-${station.freshness_window_ms ?? ''}-${station.location_label ?? ''}`}
                      api={api}
                      branchId={branchId}
                      station={station}
                      showArchived={showArchived}
                      typeLocked={typeLocked.has(id)}
                      onSaved={() => {
                        setOpen(null);
                        flashSaved(id);
                        void load();
                      }}
                      onClose={() => setOpen(null)}
                      onTypeBlocked={(inUse) => {
                        setTypeLocked(new Set([...typeLocked, id]));
                        setAsk({ kind: 'blocked', station, inUse, type: true });
                      }}
                      onArchive={() => setAsk({ kind: 'archive', station })}
                      onAddRecipe={() => setAsk({ kind: 'recipe', station, program: null })}
                      onEditRecipe={(program) =>
                        program.archived_at === null
                          ? setAsk({ kind: 'recipe', station, program })
                          : void setProgramArchived(id, program, false)
                      }
                    />
                  )}
                </div>
              </ListRow>
            );
          })}
        </List>
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
          body={fill(t('archive.station_blocked_body'), { n: String(ask.inUse.ids.length), branch: idTail(branchId) })}
          inUse={ask.inUse}
          onClose={() => setAsk(null)}
          action={
            <button type="button" className="pos-btn pos-btn--primary" onClick={() => leave(() => navigate('/menu'))}>
              {t('archive.open_items')}
            </button>
          }
        />
      )}
    </Page>
  );
}
