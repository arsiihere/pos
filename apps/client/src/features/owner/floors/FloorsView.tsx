import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CloudAdmin, CloudResult, Floor, Table } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';

// §8.1 #/floors: floors with their tables; add, rename, reorder (sort number field, no drag),
// archive / restore. Archived rows are behind a toggle (§6.2 returns them all).
type FloorRow = Floor & { tables: Table[] };

const INT_RE = /^-?[0-9]+$/;

function TextCommitField({
  name,
  label,
  value,
  onCommit,
}: {
  name: string;
  label: string;
  value: string;
  onCommit: (next: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="pos-input"
      name={name}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim();
        // A refused save reloads the same value, so the effect does not fire; reset here.
        if (next !== value && next.length >= 1 && next.length <= 60) {
          void onCommit(next).then((ok) => {
            if (!ok) setText(value);
          });
        } else setText(value);
      }}
    />
  );
}

function SortField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (next: number) => Promise<boolean>;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className="pos-input pos-input--mono"
      name="sort_order"
      inputMode="numeric"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const trimmed = text.trim();
        const next = Number(trimmed);
        if (INT_RE.test(trimmed) && Number.isSafeInteger(next) && next !== value) {
          void onCommit(next).then((ok) => {
            if (!ok) setText(String(value));
          });
        } else setText(String(value));
      }}
    />
  );
}

function AddFloorForm({ api, branchId, onCreated }: { api: CloudAdmin; branchId: string; onCreated: () => void }) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        onCreated();
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
        <span className="pos-field__label">{t('owner.floors.new_floor')}</span>
        <input className="pos-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} primary type="submit">
        {t('owner.floors.add_floor')}
      </BusyButton>
    </form>
  );
}

function AddTableForm({
  api,
  branchId,
  floorId,
  onCreated,
}: {
  api: CloudAdmin;
  branchId: string;
  floorId: string;
  onCreated: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const seatText = seats.trim();
    if (seatText !== '' && !/^[0-9]+$/.test(seatText)) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = { floor_id: floorId, name: name.trim(), ...(seatText === '' ? {} : { seats: Number(seatText) }) };
    const result = await api.createTable(branchId, body, key);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        renew();
        onCreated();
      }
      return;
    }
    renew();
    setName('');
    setSeats('');
    onCreated();
  }

  return (
    <form className="pos-row" data-form="add-table" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.floors.new_table')}</span>
        <input className="pos-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.floors.seats')}</span>
        <input
          className="pos-input pos-input--mono"
          inputMode="numeric"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
        />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} type="submit">
        {t('owner.floors.add_table')}
      </BusyButton>
    </form>
  );
}

export function FloorsView({ api, branchId }: { api: CloudAdmin; branchId: string }) {
  const [floors, setFloors] = useState<FloorRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api.listFloors(branchId);
    if (result.ok) setFloors(result.data.floors);
    else setError(errorText(result.error));
  }, [api, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(call: Promise<CloudResult<unknown>>): Promise<boolean> {
    setError(null);
    const result = await call;
    if (!result.ok) setError(errorText(result.error));
    await load();
    return result.ok;
  }

  const patchFloor = (floorId: string, body: Parameters<CloudAdmin['patchFloor']>[2]) =>
    save(api.patchFloor(branchId, floorId, body));
  const patchTable = (tableId: string, body: Parameters<CloudAdmin['patchTable']>[2]) =>
    save(api.patchTable(branchId, tableId, body));

  const visible = (row: { archived_at: number | null }) => showArchived || row.archived_at === null;

  return (
    <section className="pos-stack">
      <h1 className="title">{t('owner.floors.title')}</h1>
      {error !== null && <Banner tone="danger" text={error} />}
      <label className="pos-row">
        <input
          type="checkbox"
          name="show_archived"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        <span>{t('owner.common.show_archived')}</span>
      </label>
      {floors?.filter(visible).map((floor) => {
        const archived = floor.archived_at !== null;
        return (
          <article key={floor.floor_id} className="pos-card pos-stack" data-floor-id={floor.floor_id}>
            <div className="pos-row">
              <TextCommitField
                name="name"
                label={t('owner.floors.floor_name')}
                value={floor.name}
                onCommit={(name) => patchFloor(floor.floor_id, { name })}
              />
              <SortField
                label={t('owner.common.sort_order')}
                value={floor.sort_order}
                onCommit={(sort_order) => patchFloor(floor.floor_id, { sort_order })}
              />
              <button
                type="button"
                className="pos-btn"
                onClick={() => void patchFloor(floor.floor_id, { archived: !archived })}
              >
                {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
              </button>
            </div>
            <ul className="pos-stack">
              {floor.tables.filter(visible).map((table) => {
                const tableArchived = table.archived_at !== null;
                return (
                  <li key={table.table_id} className="pos-row" data-table-id={table.table_id}>
                    <TextCommitField
                      name="name"
                      label={t('owner.floors.table_name')}
                      value={table.name}
                      onCommit={(name) => patchTable(table.table_id, { name })}
                    />
                    <span>{table.seats === null ? '' : `${table.seats} ${t('owner.floors.seats')}`}</span>
                    <SortField
                      label={t('owner.common.sort_order')}
                      value={table.sort_order}
                      onCommit={(sort_order) => patchTable(table.table_id, { sort_order })}
                    />
                    <button
                      type="button"
                      className="pos-btn"
                      onClick={() => void patchTable(table.table_id, { archived: !tableArchived })}
                    >
                      {t(tableArchived ? 'owner.common.restore' : 'owner.common.archive')}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!archived && (
              <AddTableForm api={api} branchId={branchId} floorId={floor.floor_id} onCreated={() => void load()} />
            )}
          </article>
        );
      })}
      <AddFloorForm api={api} branchId={branchId} onCreated={() => void load()} />
    </section>
  );
}
