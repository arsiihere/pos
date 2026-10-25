import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CloudAdmin,
  CloudResult,
  CompletionMode,
  Program,
  Station,
  StationType,
} from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t, type MessageKey } from '../../../i18n';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';

// §8.1 #/stations: stations and their programs; slot / batch, capacity, freshness window (batch only,
// D17), completion mode; add, edit, archive / restore. Archived rows are behind a toggle (§6.8 returns all).
type StationRow = Station & { programs: Program[] };

const MINUTE_MS = 60_000;
const MINUTES_RE = /^[0-9]+(\.[0-9]{1,2})?$/;
const WHOLE_RE = /^[0-9]+$/;

// §8.1: times are typed in minutes and stored as _ms; the cloud checks the ranges (§3.3).
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  return MINUTES_RE.test(trimmed) ? Math.round(Number(trimmed) * MINUTE_MS) : null;
}

export function formatMinutes(ms: number): string {
  return String(Math.round((ms / MINUTE_MS) * 100) / 100);
}

function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_RE.test(trimmed) ? Number(trimmed) : null;
}

function parseName(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
}

const STATION_TYPES: { value: StationType; label: MessageKey }[] = [
  { value: 'slot', label: 'owner.stations.type_slot' },
  { value: 'batch', label: 'owner.stations.type_batch' },
];

const COMPLETION_MODES: { value: CompletionMode; label: MessageKey }[] = [
  { value: 'two_tap', label: 'owner.stations.mode_two_tap' },
  { value: 'single_tap', label: 'owner.stations.mode_single_tap' },
  { value: 'auto_done', label: 'owner.stations.mode_auto_done' },
];

// A field that saves on blur when its text parses to a new value; otherwise it shows the saved value again.
function CommitField<T>({
  name,
  label,
  value,
  parse,
  onCommit,
  numeric = false,
}: {
  name: string;
  label: string;
  value: string;
  parse: (text: string) => T | null;
  onCommit: (next: T) => void;
  numeric?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <input
        className={numeric ? 'pos-input pos-input--mono' : 'pos-input'}
        name={name}
        inputMode={numeric ? 'decimal' : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const next = parse(text);
          if (next !== null && text.trim() !== value) onCommit(next);
          else setText(value);
        }}
      />
    </label>
  );
}

function Select<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: T;
  options: { value: T; label: MessageKey }[];
  onChange: (next: T) => void;
}) {
  return (
    <label className="pos-field">
      <span className="pos-field__label">{label}</span>
      <select className="pos-select" name={name} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddStationForm({ api, branchId, onCreated }: { api: CloudAdmin; branchId: string; onCreated: () => void }) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<StationType>('slot');
  const [capacity, setCapacity] = useState('');
  const [freshness, setFreshness] = useState('');
  const [mode, setMode] = useState<CompletionMode>('two_tap');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const capacityValue = parseWhole(capacity);
    const freshnessValue = type === 'batch' && freshness.trim() !== '' ? parseMinutes(freshness) : undefined;
    if (capacityValue === null || freshnessValue === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      location_label: label.trim() === '' ? null : label.trim(),
      station_type: type,
      capacity: capacityValue,
      ...(freshnessValue === undefined ? {} : { freshness_window_ms: freshnessValue }),
      completion_mode: mode,
    };
    const result = await api.createStation(branchId, body, key);
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
    setLabel('');
    setCapacity('');
    setFreshness('');
    onCreated();
  }

  return (
    <form className="pos-stack pos-card" data-form="add-station" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.new_station')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.location_label')}</span>
        <input className="pos-input" name="location_label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <Select name="station_type" label={t('owner.stations.type')} value={type} options={STATION_TYPES} onChange={setType} />
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.capacity')}</span>
        <input
          className="pos-input pos-input--mono"
          name="capacity"
          inputMode="numeric"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
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
      <Select
        name="completion_mode"
        label={t('owner.stations.completion_mode')}
        value={mode}
        options={COMPLETION_MODES}
        onChange={setMode}
      />
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} primary type="submit">
        {t('owner.stations.add_station')}
      </BusyButton>
    </form>
  );
}

function AddProgramForm({
  api,
  branchId,
  stationId,
  onCreated,
}: {
  api: CloudAdmin;
  branchId: string;
  stationId: string;
  onCreated: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [cook, setCook] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cookMs = parseMinutes(cook);
    if (cookMs === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.createProgram(branchId, stationId, { name: name.trim(), cook_time_ms: cookMs }, key);
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
    setCook('');
    onCreated();
  }

  return (
    <form className="pos-row" data-form="add-program" noValidate onSubmit={(e) => void submit(e)}>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.new_program')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.stations.cook_minutes')}</span>
        <input
          className="pos-input pos-input--mono"
          name="cook_minutes"
          inputMode="decimal"
          value={cook}
          onChange={(e) => setCook(e.target.value)}
        />
      </label>
      {error !== null && <Banner tone="danger" text={error} />}
      <BusyButton busy={busy} type="submit">
        {t('owner.stations.add_program')}
      </BusyButton>
    </form>
  );
}

export function StationsView({ api, branchId }: { api: CloudAdmin; branchId: string }) {
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api.listStations(branchId);
    if (result.ok) setStations(result.data.stations);
    else setError(errorText(result.error));
  }, [api, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(call: Promise<CloudResult<unknown>>) {
    setError(null);
    const result = await call;
    if (!result.ok) setError(errorText(result.error));
    await load();
  }

  const patchStation = (stationId: string, body: Parameters<CloudAdmin['patchStation']>[2]) =>
    void save(api.patchStation(branchId, stationId, body));
  const patchProgram = (stationId: string, programId: string, body: Parameters<CloudAdmin['patchProgram']>[3]) =>
    void save(api.patchProgram(branchId, stationId, programId, body));

  const visible = (row: { archived_at: number | null }) => showArchived || row.archived_at === null;

  return (
    <section className="pos-stack">
      <h1 className="title">{t('owner.stations.title')}</h1>
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
      {stations?.filter(visible).map((station) => {
        const archived = station.archived_at !== null;
        const id = station.station_id;
        return (
          <article key={id} className="pos-card pos-stack" data-station-id={id}>
            <div className="pos-row">
              <CommitField
                name="name"
                label={t('owner.stations.station_name')}
                value={station.name}
                parse={parseName}
                onCommit={(name) => patchStation(id, { name })}
              />
              <CommitField
                name="location_label"
                label={t('owner.stations.location_label')}
                value={station.location_label ?? ''}
                parse={(text) => {
                  if (text.trim() === '') return { label: null };
                  const label = parseName(text);
                  return label === null ? null : { label };
                }}
                onCommit={({ label }) => patchStation(id, { location_label: label })}
              />
              <Select
                name="station_type"
                label={t('owner.stations.type')}
                value={station.station_type}
                options={STATION_TYPES}
                onChange={(station_type) => patchStation(id, { station_type })}
              />
              <CommitField
                name="capacity"
                label={t('owner.stations.capacity')}
                value={String(station.capacity)}
                parse={parseWhole}
                numeric
                onCommit={(capacity) => patchStation(id, { capacity })}
              />
              {station.station_type === 'batch' && (
                <CommitField
                  name="freshness_minutes"
                  label={t('owner.stations.freshness_minutes')}
                  value={formatMinutes(station.freshness_window_ms ?? 0)}
                  parse={parseMinutes}
                  numeric
                  onCommit={(freshness_window_ms) => patchStation(id, { freshness_window_ms })}
                />
              )}
              <Select
                name="completion_mode"
                label={t('owner.stations.completion_mode')}
                value={station.completion_mode}
                options={COMPLETION_MODES}
                onChange={(completion_mode) => patchStation(id, { completion_mode })}
              />
              <button type="button" className="pos-btn" onClick={() => patchStation(id, { archived: !archived })}>
                {t(archived ? 'owner.common.restore' : 'owner.common.archive')}
              </button>
            </div>
            {station.station_type === 'batch' && (
              <>
                <h2 className="pos-field__label">{t('owner.stations.programs')}</h2>
                <ul className="pos-stack">
                  {station.programs.filter(visible).map((program) => {
                    const programArchived = program.archived_at !== null;
                    return (
                      <li key={program.program_id} className="pos-row" data-program-id={program.program_id}>
                        <CommitField
                          name="name"
                          label={t('owner.stations.program_name')}
                          value={program.name}
                          parse={parseName}
                          onCommit={(name) => patchProgram(id, program.program_id, { name })}
                        />
                        <CommitField
                          name="cook_minutes"
                          label={t('owner.stations.cook_minutes')}
                          value={formatMinutes(program.cook_time_ms)}
                          parse={parseMinutes}
                          numeric
                          onCommit={(cook_time_ms) => patchProgram(id, program.program_id, { cook_time_ms })}
                        />
                        <button
                          type="button"
                          className="pos-btn"
                          onClick={() => patchProgram(id, program.program_id, { archived: !programArchived })}
                        >
                          {t(programArchived ? 'owner.common.restore' : 'owner.common.archive')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {!archived && <AddProgramForm api={api} branchId={branchId} stationId={id} onCreated={() => void load()} />}
              </>
            )}
          </article>
        );
      })}
      <AddStationForm api={api} branchId={branchId} onCreated={() => void load()} />
    </section>
  );
}
