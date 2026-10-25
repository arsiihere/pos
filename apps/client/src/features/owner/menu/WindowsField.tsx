import { useState } from 'react';
import type { AvailabilityWindow } from '../../../api/cloud-admin';
import { t, type MessageKey } from '../../../i18n';

// §8.1, S47: Available hours on items and categories: up to 4 from–to rows in HH:MM; no rows = always.
// An end before its start wraps past midnight; equal times are refused (§3.3).
export const MAX_WINDOWS = 4;

const MINUTE_MS = 60_000;
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

function formatTime(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

export function WindowsField({
  value,
  onChange,
}: {
  value: readonly AvailabilityWindow[];
  onChange: (windows: AvailabilityWindow[] | null) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    value.map((w, i) => ({ id: i, start: formatTime(w.start_ms), end: formatTime(w.end_ms) })),
  );
  const [nextId, setNextId] = useState(value.length);

  function update(next: Row[]) {
    setRows(next);
    onChange(windowsOf(next));
  }

  return (
    <fieldset className="pos-field" data-field="availability_windows">
      <legend className="pos-field__label">{t('owner.hours.label')}</legend>
      {rows.length === 0 && <p className="pos-field__help">{t('owner.hours.always')}</p>}
      {rows.map((row) => {
        const error = rowError(row);
        const set = (patch: Partial<Row>) => update(rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
        return (
          <div key={row.id} className={`pos-stack${error === null ? '' : ' pos-field--error'}`} data-window-row="">
            <div className="pos-row pos-ltr">
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
                {t('owner.hours.remove')}
              </button>
            </div>
            {error !== null && <p className="pos-field__error">{t(error)}</p>}
          </div>
        );
      })}
      {rows.length < MAX_WINDOWS && (
        <button
          type="button"
          className="pos-btn"
          onClick={() => {
            update([...rows, { id: nextId, start: '', end: '' }]);
            setNextId(nextId + 1);
          }}
        >
          {t('owner.hours.add')}
        </button>
      )}
    </fieldset>
  );
}
