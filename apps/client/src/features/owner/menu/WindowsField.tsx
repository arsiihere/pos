import { useState } from 'react';
import type { AvailabilityWindow } from '../../../api/cloud-admin';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';

// §8.1, S47 (01a-C01): Available hours on items and categories. All day = no rows; Only at set hours
// shows up to 4 from–to rows in HH:MM. An end before its start wraps past midnight (an info chip says
// so); equal times are refused (§3.3). An item inside a category with hours shows when both allow it.
export const MAX_WINDOWS = 4;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const HHMM_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

interface Row {
  id: number;
  start: string;
  end: string;
}

function parseTime(text: string): number | null {
  const m = HHMM_RE.exec(text.trim());
  return m === null ? null : (Number(m[1]) * 60 + Number(m[2])) * MINUTE_MS;
}

export function formatTime(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function windowText(w: AvailabilityWindow): string {
  return `${formatTime(w.start_ms)}–${formatTime(w.end_ms)}`;
}

function rowError(row: Row): MessageKey | null {
  if (row.start.trim() === '' || row.end.trim() === '') return null;
  const start = parseTime(row.start);
  const end = parseTime(row.end);
  if (start === null || end === null) return 'owner.hours.invalid';
  return start === end ? 'owner.hours.equal' : null;
}

// null while any row is incomplete or invalid, so the form cannot be sent.
function windowsOf(rows: Row[]): AvailabilityWindow[] | null {
  const windows: AvailabilityWindow[] = [];
  for (const row of rows) {
    const start = parseTime(row.start);
    const end = parseTime(row.end);
    if (start === null || end === null || start === end) return null;
    windows.push({ start_ms: start, end_ms: end });
  }
  return windows;
}

// A window as plain [start, end) spans within one day (a wrap becomes two).
function spans(w: AvailabilityWindow): [number, number][] {
  return w.end_ms > w.start_ms
    ? [[w.start_ms, w.end_ms]]
    : [
        [w.start_ms, DAY_MS],
        [0, w.end_ms],
      ];
}

// The first stretch of the day both sets allow, or null when they never meet.
export function overlap(inner: readonly AvailabilityWindow[], outer: readonly AvailabilityWindow[]): AvailabilityWindow | null {
  for (const a of inner.flatMap(spans)) {
    for (const b of outer.flatMap(spans)) {
      const start = Math.max(a[0], b[0]);
      const end = Math.min(a[1], b[1]);
      if (start < end) return { start_ms: start, end_ms: end % DAY_MS };
    }
  }
  return null;
}

export function WindowsField({
  value,
  onChange,
  outer = [],
  outerName,
}: {
  value: readonly AvailabilityWindow[];
  onChange: (windows: AvailabilityWindow[] | null) => void;
  outer?: readonly AvailabilityWindow[];
  outerName?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    value.map((w, i) => ({ id: i, start: formatTime(w.start_ms), end: formatTime(w.end_ms) })),
  );
  const [nextId, setNextId] = useState(value.length);
  const [setHours, setSetHours] = useState(value.length > 0);

  function update(next: Row[]) {
    setRows(next);
    onChange(windowsOf(next));
  }

  function addRow(current: Row[]) {
    update([...current, { id: nextId, start: '', end: '' }]);
    setNextId(nextId + 1);
  }

  const windows = windowsOf(rows);
  const both = windows !== null && windows.length > 0 && outer.length > 0 ? overlap(windows, outer) : null;

  return (
    <fieldset className="pos-field" data-field="availability_windows">
      <legend className="pos-field__label">{t('owner.hours.label')}</legend>
      {outerName !== undefined && (
        <p className="pos-field__help">
          {outer.length === 0
            ? fill(t('owner.hours.category_none'), { name: outerName })
            : fill(t('owner.hours.category_has'), { name: outerName, hours: outer.map(windowText).join(', ') })}
        </p>
      )}
      <Segmented
        label={t('owner.hours.label')}
        value={setHours ? 'set' : 'all'}
        options={[
          { value: 'all', label: t('owner.hours.all_day') },
          { value: 'set', label: t('owner.hours.set_hours') },
        ]}
        onChange={(next) => {
          if (next === 'all') {
            setSetHours(false);
            update([]);
          } else {
            setSetHours(true);
            if (rows.length === 0) addRow([]);
          }
        }}
      />
      {!setHours && <p className="pos-field__help">{t('owner.hours.always')}</p>}
      {setHours &&
        rows.map((row) => {
          const error = rowError(row);
          const start = parseTime(row.start);
          const end = parseTime(row.end);
          const wraps = error === null && start !== null && end !== null && end < start;
          const set = (patch: Partial<Row>) => update(rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
          return (
            <div key={row.id} className={`pos-stack${error === null ? '' : ' pos-field--error'}`} data-window-row="">
              <div className="pos-hours-row pos-ltr">
                <label className="pos-field">
                  <span className="pos-field__label">{t('owner.hours.from')}</span>
                  <input
                    className="pos-input pos-input--mono"
                    type="time"
                    name="start"
                    value={row.start}
                    onChange={(e) => set({ start: e.target.value })}
                  />
                </label>
                <label className="pos-field">
                  <span className="pos-field__label">{t('owner.hours.to')}</span>
                  <input
                    className="pos-input pos-input--mono"
                    type="time"
                    name="end"
                    value={row.end}
                    onChange={(e) => set({ end: e.target.value })}
                  />
                </label>
                <button type="button" className="pos-btn" onClick={() => update(rows.filter((r) => r.id !== row.id))}>
                  <Icon name="x" />
                  {t('owner.hours.remove')}
                </button>
              </div>
              {wraps && (
                <Chip tone="info">
                  {fill(t('owner.hours.wraps'), { hours: `${row.start}–${row.end}` })}
                </Chip>
              )}
              {error !== null && <p className="pos-field__error">{t(error)}</p>}
            </div>
          );
        })}
      {setHours && rows.length < MAX_WINDOWS && (
        <button type="button" className="pos-btn pos-btn--start" onClick={() => addRow(rows)}>
          <Icon name="plus" />
          {fill(t('owner.hours.add_n'), { n: String(MAX_WINDOWS - rows.length) })}
        </button>
      )}
      {both !== null && <Chip tone="info">{fill(t('owner.hours.overlap'), { hours: windowText(both) })}</Chip>}
    </fieldset>
  );
}
