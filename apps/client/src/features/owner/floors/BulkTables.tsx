import { useEffect, useState } from 'react';
import type { CloudAdmin, CloudError } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { idTail } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText, useIdempotencyKey } from '../form';
import { addTables, keyAt, parseRange, takenNames } from './bulk-add';

// S51: From · To · Seats each → one §6.5 POST per table. Names are checked against the branch's
// tables before anything is sent; table i carries keyAt(formKey, i); any change to what goes into a
// request renews the form key; Add again resumes from the failed table.
export interface RangeInput {
  first: string;
  last: string;
  seats: string;
}

export function rangeNames(range: RangeInput): string[] | null {
  return parseRange(range.first, range.last);
}

export function parseSeats(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^[0-9]+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= 100 ? Number(trimmed) : undefined;
}

export function previewText(names: readonly string[], seats: number | null): string {
  const list = names.length <= 4 ? names.join(', ') : `${names[0]}, ${names[1]} … ${names.at(-1)}`;
  return seats === null
    ? fill(t('floors.adds_n_no_seats'), { n: String(names.length), list })
    : fill(t('floors.adds_n'), { n: String(names.length), list, seats: String(seats) });
}

// The loop itself, shared by the Add tables row and the first-floor form.
export function useBulkAdd(api: CloudAdmin, branchId: string, existing: readonly string[], onBusy: (busy: boolean) => void) {
  const { key, renew } = useIdempotencyKey();
  const [next, setNext] = useState(0);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return {
    progress,
    error,
    setError,
    // Any change to the range, seats, floor or branch starts a new form (S51).
    reset() {
      renew();
      setNext(0);
      setError(null);
    },
    async run(floorId: string, names: readonly string[], seats: number | null): Promise<boolean> {
      if (next === 0) {
        const taken = takenNames(names, existing);
        if (taken.length > 0) {
          setError(fill(t('floors.names_taken'), { names: taken.join(', '), branch: idTail(branchId) }));
          return false;
        }
      }
      const present = new Set(existing.map((n) => n.trim().toLowerCase()));
      setError(null);
      onBusy(true);
      const outcome = await addTables(
        names,
        next,
        (name, i) =>
          present.has(name.trim().toLowerCase())
            ? Promise.resolve({ ok: true as const, data: null })
            : api.createTable(branchId, { floor_id: floorId, name, ...(seats === null ? {} : { seats }) }, keyAt(key, i)),
        (i) => setProgress({ i, n: names.length }),
      );
      onBusy(false);
      setProgress(null);
      setNext(outcome.next);
      if (outcome.error !== null) {
        setError(failedText(names[outcome.next] ?? '', outcome.error));
        return false;
      }
      renew();
      setNext(0);
      return true;
    },
  };
}

function failedText(name: string, error: CloudError): string {
  return fill(t('floors.stopped_at'), { name, reason: errorText(error) ?? '' });
}

export function BulkTables({
  api,
  branchId,
  floorId,
  existing,
  onDone,
  onCancel,
  onBusy,
}: {
  api: CloudAdmin;
  branchId: string;
  floorId: string;
  existing: readonly string[];
  onDone: (added: boolean) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [range, setRange] = useState<RangeInput>({ first: '', last: '', seats: '' });
  const bulk = useBulkAdd(api, branchId, existing, onBusy);
  const down = useCloudDown(api);
  const names = rangeNames(range);
  const seats = parseSeats(range.seats);
  const complete = range.first.trim() !== '' && range.last.trim() !== '';

  // A new floor or branch is a new form (S51).
  useEffect(() => bulk.reset(), [floorId, branchId]);

  const change = (patch: Partial<RangeInput>) => {
    setRange({ ...range, ...patch });
    bulk.reset();
  };

  return (
    <div className="pos-explain pos-stack" data-form="bulk-tables">
      <div className="pos-row">
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.from')}</span>
          <input className="pos-input pos-input--mono" name="first" value={range.first} onChange={(e) => change({ first: e.target.value })} />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.to')}</span>
          <input className="pos-input pos-input--mono" name="last" value={range.last} onChange={(e) => change({ last: e.target.value })} />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.seats_each')}</span>
          <input
            className="pos-input pos-input--mono"
            name="seats"
            inputMode="numeric"
            value={range.seats}
            onChange={(e) => change({ seats: e.target.value })}
          />
        </label>
      </div>
      {names !== null && seats !== undefined && <p className={typeClass('body')}>{previewText(names, seats)}</p>}
      {complete && names === null && <p className="pos-field__error">{t('floors.range_invalid')}</p>}
      {bulk.error !== null && <Banner tone="danger" text={bulk.error} />}
      <div className="pos-row">
        <button type="button" className="pos-btn" onClick={onCancel} disabled={bulk.progress !== null}>
          {t('common.cancel')}
        </button>
        <BusyButton
          busy={bulk.progress !== null}
          disabled={names === null || seats === undefined || down}
          onClick={() => {
            if (names === null || seats === undefined) return;
            void bulk.run(floorId, names, seats).then((ok) => onDone(ok));
          }}
        >
          {bulk.progress !== null
            ? fill(t('floors.adding_progress'), { i: String(bulk.progress.i), n: String(bulk.progress.n) })
            : fill(t('floors.add_n_tables'), { n: String(names?.length ?? 0) })}
        </BusyButton>
      </div>
    </div>
  );
}
