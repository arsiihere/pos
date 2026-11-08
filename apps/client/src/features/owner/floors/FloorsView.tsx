import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CloudAdmin, CloudError, CloudResult, FloorWithZones, Table, ZoneSummary } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { SavedChip, UndoChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { language, t } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { BranchSelect, Page } from '../Shell';
import { BulkTables, parseSeats, previewText, rangeNames, useBulkAdd, type RangeInput } from './BulkTables';
import { TableDialog } from './TableDialog';
import { ZoneDialog } from './ZoneDialog';

// §8.1 #/floors (01a-S03): one section per floor with its tables as tiles; a table opens a dialog
// (with a floor move); Add tables adds a range (S51); the first floor and its tables come from one form.
// Archived rows are behind Show archived (§6.2 returns them all). A floor is archived after a confirm, or
// shows what blocks it; a table archives at once with an 8 s Undo (S50 b). Saves show a Saved chip (S50 d).
// Pulse (01a hand-off CHANGES §2): Rename / Archive sit in each floor's More menu; Show archived is an
// app-bar More item, and while archived floors show, the "Archived shown ✕" filter chip hides them.
// 01a v2.2 §6.2: each floor also lists its zones (without their item lists, which the zone editor reads).
type FloorRow = FloorWithZones;

const INT_RE = /^-?[0-9]+$/;
const active = (row: { archived_at: number | null }) => row.archived_at === null;

function CommitInput({
  name,
  label,
  value,
  mono = false,
  parse,
  onCommit,
}: {
  name: string;
  label: string;
  value: string;
  mono?: boolean;
  parse: (text: string) => string | number | null;
  onCommit: (next: string | number) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <input
        className={mono ? 'pos-input pos-input--mono' : 'pos-input'}
        name={name}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = parse(text);
          // A refused save reloads the same value, so the effect does not fire; reset here.
          if (next !== null && text.trim() !== value) {
            void onCommit(next).then((ok) => {
              if (!ok) setText(value);
            });
          } else setText(value);
        }}
      />
    </label>
  );
}

const parseName = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
};
const parseSort = (text: string) => {
  const trimmed = text.trim();
  return INT_RE.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : null;
};

function seatsText(n: number): string {
  return fill(t('owner.floors.seats_n'), { n: String(n) });
}

function floorCounts(tables: readonly Table[]): { tables: string; seats: string } {
  const live = tables.filter(active);
  return { tables: String(live.length), seats: String(live.reduce((sum, x) => sum + (x.seats ?? 0), 0)) };
}

function floorSummary(tables: readonly Table[]): string {
  return fill(t('floors.summary'), floorCounts(tables));
}

function shortDate(ms: number): string {
  return new Intl.DateTimeFormat(language() === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short' }).format(ms);
}

function AddFloorForm({
  api,
  branchId,
  onCreated,
  onMismatch,
}: {
  api: CloudAdmin;
  branchId: string;
  onCreated: () => void;
  onMismatch: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api.createFloor(branchId, { name: name.trim() }, key);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        renew();
        onMismatch();
      }
      return;
    }
    renew();
    setName('');
    onCreated();
  }

  return (
    <form className="pos-stack" data-form="add-floor" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.floors.floor_name')}</span>
        <input className="pos-input" name="floor_name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} primary disabled={down} type="submit">
        {t('owner.floors.add_floor')}
      </BusyButton>
    </form>
  );
}

// OwnerFloorsEmpty: the first floor and its tables in one form (≤ 6 actions, S51).
function FirstFloorForm({
  api,
  branchId,
  onDone,
  onMismatch,
}: {
  api: CloudAdmin;
  branchId: string;
  onDone: () => void;
  onMismatch: (text: string | null) => void;
}) {
  const floorKey = useIdempotencyKey();
  const [name, setName] = useState('');
  const [range, setRange] = useState<RangeInput>({ first: '', last: '', seats: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floorId, setFloorId] = useState<string | null>(null);
  const bulk = useBulkAdd(api, branchId, [], setBusy);
  const down = useCloudDown(api);
  const hasRange = range.first.trim() !== '' || range.last.trim() !== '';
  const names = hasRange ? rangeNames(range) : [];
  const seats = parseSeats(range.seats);

  const change = (patch: Partial<RangeInput>) => {
    setRange({ ...range, ...patch });
    bulk.reset();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || names === null || seats === undefined) return;
    setError(null);
    let id = floorId;
    if (id === null) {
      setBusy(true);
      const result = await api.createFloor(branchId, { name: name.trim() }, floorKey.key);
      setBusy(false);
      if (!result.ok) {
        setError(errorText(result.error));
        if (isKeyMismatch(result.error)) {
          // The reload may show the floor, which replaces this form; the view keeps the text.
          floorKey.renew();
          onMismatch(errorText(result.error));
        }
        return;
      }
      floorKey.renew();
      id = result.data.floor.floor_id;
      setFloorId(id);
    }
    if (names.length > 0 && !(await bulk.run(id, names, seats))) return;
    setName('');
    setFloorId(null);
    onDone();
  }

  const label =
    names !== null && names.length > 0
      ? fill(t('floors.add_floor_and_tables'), { n: String(names.length) })
      : t('owner.floors.add_floor');

  return (
    <form className="pos-empty pos-card pos-firstfloor" data-form="add-floor" noValidate onSubmit={(e) => void submit(e)}>
      <div className="pos-section__head">
        <h2>{t('floors.first_title')}</h2>
        <p>{t('floors.first_body')}</p>
      </div>
      <div className="pos-grid">
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.floors.floor_name')}</span>
          <input className="pos-input" name="floor_name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.seats_per_table')}</span>
          <input
            className="pos-input pos-input--mono"
            name="seats"
            inputMode="numeric"
            value={range.seats}
            onChange={(e) => change({ seats: e.target.value })}
          />
          <span className="pos-field__help">{t('floors.seats_help')}</span>
        </label>
      </div>
      <div className="pos-grid">
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.first_table')}</span>
          <input className="pos-input pos-input--mono" name="first" value={range.first} onChange={(e) => change({ first: e.target.value })} />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.last_table')}</span>
          <input className="pos-input pos-input--mono" name="last" value={range.last} onChange={(e) => change({ last: e.target.value })} />
        </label>
      </div>
      {names !== null && names.length > 0 && seats !== undefined && (
        <p className="pos-explain">
          <Icon name="check" />
          <span>
            {previewText(names, seats)} {t('floors.parking_note')}
          </span>
        </p>
      )}
      {names === null && <p className="pos-field__error">{t('floors.range_invalid')}</p>}
      {(error ?? bulk.error) !== null && <Banner tone="danger" text={error ?? bulk.error ?? ''} />}
      <div className="pos-row pos-firstfloor__go">
        <BusyButton busy={busy} primary size="lg" disabled={down || names === null || seats === undefined} type="submit">
          {bulk.progress !== null
            ? fill(t('floors.adding_progress'), { i: String(bulk.progress.i), n: String(bulk.progress.n) })
            : label}
        </BusyButton>
      </div>
    </form>
  );
}

type Ask =
  | { kind: 'archive-floor'; floor: FloorRow }
  | { kind: 'floor-blocked'; floor: FloorRow; tables: string[]; zones: string[] }
  | null;

// What keeps a floor from being archived: its active tables (§6.4) and its active zones (02a A-1, AD-6).
function blockedAsk(floor: FloorRow): Ask {
  const tables = floor.tables.filter(active).map((x) => x.name);
  const zones = floor.zones.filter(active).map((z) => z.name);
  return tables.length > 0 || zones.length > 0 ? { kind: 'floor-blocked', floor, tables, zones } : { kind: 'archive-floor', floor };
}

function blockedBody(tables: number, zones: number): string {
  return [
    ...(tables > 0 ? [fill(t('archive.floor_blocked_body'), { n: String(tables) })] : []),
    ...(zones > 0 ? [fill(t('archive.floor_zones_body'), { n: String(zones) })] : []),
  ].join(' ');
}

function blockedAction(tables: number, zones: number): string {
  if (zones === 0) return fill(t('archive.floor_tables_then_floor'), { n: String(tables) });
  if (tables === 0) return fill(t('archive.floor_zones_then_floor'), { n: String(zones) });
  return fill(t('archive.floor_all_then_floor'), { tables: String(tables), zones: String(zones) });
}

export function FloorsView({
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
  const [floors, setFloors] = useState<FloorRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [bulkFloor, setBulkFloor] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addingFloor, setAddingFloor] = useState(false);
  const [editing, setEditing] = useState<{ table: Table; floorId: string } | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [undo, setUndo] = useState<{ table?: Table; zone?: ZoneSummary; floorId: string } | null>(null);
  const [zoneEdit, setZoneEdit] = useState<{ zone: ZoneSummary | null; floorId: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const down = useCloudDown(api);

  const load = useCallback(async () => {
    const result = await api.listFloors(branchId);
    if (result.ok) setFloors(result.data.floors);
    else setError(errorText(result.error));
  }, [api, branchId]);

  useEffect(() => {
    setFloors(null);
    void load();
  }, [load]);

  // S53: a read that failed while the cloud was down is made again once it is back.
  const wasDown = useRef(down);
  useEffect(() => {
    if (wasDown.current && !down && floors === null) void load();
    wasDown.current = down;
  }, [down, floors, load]);

  function flashSaved(id: string) {
    setSavedId(id);
    saved.flash();
  }

  function report(err: CloudError) {
    setError(errorText(err));
  }

  async function save(id: string, call: Promise<CloudResult<unknown>>): Promise<CloudError | null> {
    setError(null);
    const result = await call;
    if (!result.ok) report(result.error);
    else flashSaved(id);
    await load();
    return result.ok ? null : result.error;
  }

  const patchFloor = (floorId: string, body: Parameters<CloudAdmin['patchFloor']>[2]) =>
    save(floorId, api.patchFloor(branchId, floorId, body));

  const allNames = (floors ?? []).flatMap((f) => f.tables.map((x) => x.name));
  const visible = (row: { archived_at: number | null }) => showArchived || row.archived_at === null;

  async function archiveFloor(floor: FloorRow) {
    setAsk(null);
    const failed = await patchFloor(floor.floor_id, { archived: true });
    if (failed?.kind === 'api' && failed.code === 'CONFIG_IN_USE') {
      // The used_by ids are tables or zones (AD-6); the dialog names both from what is loaded.
      setError(null);
      setAsk(blockedAsk(floor));
    }
  }

  async function archiveAllThenFloor(floor: FloorRow) {
    setAsk(null);
    for (const zone of floor.zones.filter(active)) {
      const result = await api.patchZone(branchId, zone.zone_id, { archived: true });
      if (!result.ok) {
        report(result.error);
        await load();
        return;
      }
    }
    for (const table of floor.tables.filter(active)) {
      const result = await api.patchTable(branchId, table.table_id, { archived: true });
      if (!result.ok) {
        report(result.error);
        await load();
        return;
      }
    }
    await patchFloor(floor.floor_id, { archived: true });
  }

  async function archiveTable(table: Table, floorId: string) {
    setEditing(null);
    const failed = await save(floorId, api.patchTable(branchId, table.table_id, { archived: true }));
    if (failed === null) setUndo({ table, floorId });
  }

  async function restoreTable(table: Table, floorId: string) {
    setUndo(null);
    const failed = await save(floorId, api.patchTable(branchId, table.table_id, { archived: false }));
    if (failed?.kind === 'api' && failed.code === 'CONFIG_NAME_TAKEN') {
      setError(fill(t('errors.CONFIG_NAME_TAKEN_table'), { name: table.name, branch: branchName(branchId) }));
    }
  }

  async function archiveZone(zone: ZoneSummary, floorId: string) {
    setZoneEdit(null);
    const failed = await save(floorId, api.patchZone(branchId, zone.zone_id, { archived: true }));
    if (failed === null) setUndo({ zone, floorId });
  }

  async function restoreZone(zone: ZoneSummary, floorId: string) {
    setUndo(null);
    setZoneEdit(null);
    await save(floorId, api.patchZone(branchId, zone.zone_id, { archived: false }));
  }

  const empty = floors !== null && floors.length === 0;

  return (
    <Page
      api={api}
      title={t('owner.floors.title')}
      after={<BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} disabled={bulkBusy} />}
      end={
        !empty && (
          <>
            {showArchived && (
              <button
                type="button"
                className="pos-filterchip"
                aria-label={t('floors.hide_archived')}
                onClick={() => setShowArchived(false)}
              >
                <Icon name="archive" />
                {t('floors.archived_shown')}
                <Icon name="x" />
              </button>
            )}
            <MoreMenu
              label={t('owner.floors.more')}
              items={[
                {
                  label: t(showArchived ? 'floors.hide_archived' : 'owner.common.show_archived'),
                  icon: 'archive',
                  onSelect: () => setShowArchived(!showArchived),
                },
              ]}
            />
            <button type="button" className="pos-btn pos-btn--primary" onClick={() => setAddingFloor(true)}>
              <Icon name="plus" />
              {t('owner.floors.add_floor')}
            </button>
          </>
        )
      }
    >
      {error !== null && <Banner tone="danger" text={error} />}
      {floors === null && <Skeleton lines={4} />}
      {empty && (
        <FirstFloorForm
          api={api}
          branchId={branchId}
          onDone={() => void load()}
          onMismatch={(text) => {
            setError(text);
            void load();
          }}
        />
      )}
      {floors?.filter(visible).map((floor) => {
        const archived = floor.archived_at !== null;
        const id = floor.floor_id;
        if (archived) {
          return (
            <section key={id} className="pos-section pos-section--archived" data-floor-id={id}>
              <div className="pos-section__top">
                <div className="pos-section__head">
                  <h2>{floor.name}</h2>
                  <p>
                    {fill(t('floors.archived_on'), {
                      date: shortDate(floor.archived_at ?? 0),
                      n: String(floor.tables.length),
                    })}
                  </p>
                </div>
                <div className="pos-section__tools">
                  <Chip tone="info" icon="archive">
                    {t('owner.common.archived')}
                  </Chip>
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={down}
                    onClick={() => void patchFloor(id, { archived: false })}
                  >
                    {t('owner.common.restore')}
                  </button>
                </div>
              </div>
            </section>
          );
        }
        return (
          <section key={id} className="pos-section" data-floor-id={id}>
            <div className="pos-section__top">
              {renaming === id ? (
                <div className="pos-row">
                  <CommitInput
                    name="name"
                    label={t('owner.floors.floor_name')}
                    value={floor.name}
                    parse={parseName}
                    onCommit={async (name) => (await patchFloor(id, { name: String(name) })) === null}
                  />
                  <CommitInput
                    name="sort_order"
                    label={t('floors.position')}
                    value={String(floor.sort_order)}
                    mono
                    parse={parseSort}
                    onCommit={async (sort) => (await patchFloor(id, { sort_order: Number(sort) })) === null}
                  />
                  <button type="button" className="pos-btn" onClick={() => setRenaming(null)}>
                    {t('floors.done')}
                  </button>
                </div>
              ) : (
                <div className="pos-section__head">
                  <h2>{floor.name}</h2>
                  <p>{floorSummary(floor.tables)}</p>
                </div>
              )}
              <div className="pos-section__tools">
                <SavedChip shown={saved.shown && savedId === id} />
                {undo?.floorId === id && (
                  <UndoChip
                    paused={down}
                    onUndo={() => void (undo.zone !== undefined ? restoreZone(undo.zone, id) : restoreTable(undo.table as Table, id))}
                    onDone={() => setUndo(null)}
                  />
                )}
                <MoreMenu
                  label={fill(t('common.more_for'), { name: floor.name })}
                  info={{
                    title: floor.name,
                    detail: fill(t('floors.menu_info'), {
                      n: String(floor.sort_order),
                      t: floorCounts(floor.tables).tables,
                      s: floorCounts(floor.tables).seats,
                    }),
                  }}
                  items={[
                    ...(renaming === id ? [] : [{ label: t('floors.rename'), icon: 'edit' as const, onSelect: () => setRenaming(id) }]),
                    {
                      label: fill(t('floors.menu_archive'), { floor: floor.name }),
                      icon: 'archive',
                      danger: true,
                      disabled: down,
                      onSelect: () => setAsk(blockedAsk(floor)),
                    },
                  ]}
                />
              </div>
            </div>
            <div className="pos-row" data-zones={id}>
              <span className="pos-field__label">{t('zones.title')}</span>
              {floor.zones.filter(visible).map((zone) => (
                <button
                  key={zone.zone_id}
                  type="button"
                  className={`pos-filterchip${zone.archived_at === null ? '' : ' is-muted'}`}
                  data-zone-id={zone.zone_id}
                  onClick={() => setZoneEdit({ zone, floorId: id })}
                >
                  {zone.name}
                  {zone.archived_at !== null && <small> {t('owner.common.archived')}</small>}
                </button>
              ))}
              <button type="button" className="pos-btn" disabled={down} onClick={() => setZoneEdit({ zone: null, floorId: id })}>
                <Icon name="plus" />
                {t('zones.add')}
              </button>
            </div>
            <div className="pos-tiles">
              {floor.tables.filter(visible).map((table) => (
                <button
                  key={table.table_id}
                  type="button"
                  className={`pos-tile${table.archived_at === null ? '' : ' is-muted'}`}
                  data-table-id={table.table_id}
                  onClick={() => setEditing({ table, floorId: id })}
                >
                  <strong className="pos-ltr">{table.name}</strong>
                  {table.seats !== null && <small>{seatsText(table.seats)}</small>}
                  {table.zone_id !== null && floor.zones.some((z) => z.zone_id === table.zone_id) && (
                    <small>{floor.zones.find((z) => z.zone_id === table.zone_id)?.name}</small>
                  )}
                  {table.archived_at !== null && <small>{t('owner.common.archived')}</small>}
                </button>
              ))}
              {bulkFloor !== id && (
                <button type="button" className="pos-tile pos-tile--add" onClick={() => setBulkFloor(id)}>
                  <Icon name="plus" />
                  {t('floors.add_tables')}
                </button>
              )}
            </div>
            {bulkFloor === id && (
              <BulkTables
                api={api}
                branchId={branchId}
                floorId={id}
                existing={allNames}
                onBusy={setBulkBusy}
                onCancel={() => setBulkFloor(null)}
                onDone={(added) => {
                  if (added) {
                    setBulkFloor(null);
                    flashSaved(id);
                  }
                  void load();
                }}
              />
            )}
          </section>
        );
      })}

      {addingFloor && (
        <Dialog title={t('owner.floors.add_floor')} onClose={() => setAddingFloor(false)}>
          <AddFloorForm
            api={api}
            branchId={branchId}
            onCreated={() => {
              setAddingFloor(false);
              void load();
            }}
            onMismatch={() => void load()}
          />
        </Dialog>
      )}
      {editing !== null && (
        <TableDialog
          api={api}
          branchId={branchId}
          table={editing.table}
          floorId={editing.floorId}
          floors={floors ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            const floorId = editing.floorId;
            setEditing(null);
            flashSaved(floorId);
            void load();
          }}
          onArchive={() => void archiveTable(editing.table, editing.floorId)}
          onRestore={() => {
            const { table, floorId } = editing;
            setEditing(null);
            void restoreTable(table, floorId);
          }}
        />
      )}
      {zoneEdit !== null && (
        <ZoneDialog
          api={api}
          branchId={branchId}
          floor={floors?.find((f) => f.floor_id === zoneEdit.floorId) ?? { floor_id: zoneEdit.floorId, name: '' }}
          zone={zoneEdit.zone}
          onClose={() => setZoneEdit(null)}
          onSaved={() => {
            const floorId = zoneEdit.floorId;
            setZoneEdit(null);
            flashSaved(floorId);
            void load();
          }}
          onArchive={() => zoneEdit.zone !== null && void archiveZone(zoneEdit.zone, zoneEdit.floorId)}
          onRestore={() => zoneEdit.zone !== null && void restoreZone(zoneEdit.zone, zoneEdit.floorId)}
        />
      )}
      {ask?.kind === 'archive-floor' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.floor.name })}
          body={t('archive.floor_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.floor.name })}
          tone="danger"
          onConfirm={() => void archiveFloor(ask.floor)}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'floor-blocked' && (
        <Dialog
          title={fill(t('archive.blocked_title'), { name: ask.floor.name })}
          onClose={() => setAsk(null)}
          footer={
            <>
              <button type="button" className="pos-btn" onClick={() => setAsk(null)}>
                {t('common.close')}
              </button>
              <button type="button" className="pos-btn pos-btn--danger" onClick={() => void archiveAllThenFloor(ask.floor)}>
                {blockedAction(ask.tables.length, ask.zones.length)}
              </button>
            </>
          }
        >
          <p className="pos-dialog__body">{blockedBody(ask.tables.length, ask.zones.length)}</p>
          <div className="pos-chipgrid">
            {[...ask.tables, ...ask.zones].map((name, i) => (
              <Chip key={`${i}-${name}`}>
                <span className="pos-ltr">{name}</span>
              </Chip>
            ))}
          </div>
        </Dialog>
      )}
    </Page>
  );
}
