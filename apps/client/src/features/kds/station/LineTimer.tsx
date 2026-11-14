import type { LineDetail } from '@pos/domain';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsRow } from '../store';

// 03b v1.0.8 §3.3, #71 (K2; frame 03b-C03): the Now row's timer. Started → "cooking m:ss" since started_at; not
// started → "waiting m:ss" since fired_at; late (red, "late +N min", never colour alone) when now > planned_done_ms
// (= started_at + cook_ms, else fired_at + prep_ms + cook_ms). `now` is always the hub clock (`hub_time`, S47), never
// the device's. An hour or more reads h:mm:ss.

export type TimerState =
  | { kind: 'done' }
  | { kind: 'late'; minutes: number }
  | { kind: 'cooking'; elapsed: number; pct: number }
  | { kind: 'waiting'; elapsed: number; pct: number };

export function plannedDoneMs(row: Pick<KdsRow, 'started_at' | 'fired_at'>, d: Pick<LineDetail, 'cook_ms' | 'prep_ms'>): number | null {
  if (row.started_at !== null) return row.started_at + d.cook_ms;
  if (row.fired_at !== null) return row.fired_at + d.prep_ms + d.cook_ms;
  return null;
}

/** m:ss, or h:mm:ss from an hour on; negative → 0:00 */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function timerOf(row: KdsRow, d: LineDetail, now: number): TimerState {
  if (row.stage === 'done') return { kind: 'done' };
  const planned = plannedDoneMs(row, d);
  if (planned !== null && now > planned) return { kind: 'late', minutes: Math.ceil((now - planned) / 60_000) };
  const pct = (elapsed: number, of: number) => (of > 0 ? Math.min(100, (elapsed / of) * 100) : 0);
  if (row.stage === 'cooking') {
    const elapsed = Math.max(0, now - (row.started_at ?? row.fired_at ?? now));
    return { kind: 'cooking', elapsed, pct: pct(elapsed, d.cook_ms) };
  }
  const elapsed = Math.max(0, now - (row.fired_at ?? now));
  return { kind: 'waiting', elapsed, pct: pct(elapsed, d.prep_ms + d.cook_ms) };
}

const TONE = { done: 'ok', late: 'danger', cooking: 'brand', waiting: 'mute' } as const;

/** The ring of a Now card: 84 px at 1920, 76 px on the 1280 tablet (classes in kds-03-additions.css, IR-14). */
export function LineTimer({ row, detail, nowMs, compact }: { row: KdsRow; detail: LineDetail; nowMs: number; compact: boolean }) {
  const st = timerOf(row, detail, nowMs);
  const size = compact ? 76 : 84;
  const stroke = 7;
  const c = size / 2;
  const r = c - stroke / 2;
  const pct = st.kind === 'done' || st.kind === 'late' ? 100 : st.pct;
  const text = st.kind === 'cooking' || st.kind === 'waiting' ? clockText(st.elapsed) : '';
  const label =
    st.kind === 'late'
      ? fill(t('kds.late'), { n: String(st.minutes) })
      : st.kind === 'done'
        ? t('kds.ring.done')
        : fill(t(st.kind === 'cooking' ? 'kds.cooking' : 'kds.waiting'), { time: text });
  return (
    <div className={text.length > 5 ? 'ktm long' : 'ktm'}>
      <span className={`ring ring--${size} c-${TONE[st.kind]}`} role="img" aria-label={label}>
        <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="trk" cx={c} cy={c} r={r} strokeWidth={stroke} />
          <circle className="val" cx={c} cy={c} r={r} pathLength={100} strokeWidth={stroke} strokeDasharray={`${pct.toFixed(1)} 100`} />
        </svg>
        <span className="ring__in">
          {st.kind === 'done' ? (
            <>
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <small>{t('kds.ring.done')}</small>
            </>
          ) : st.kind === 'late' ? (
            <>
              <b>+{st.minutes}</b>
              <small>{t('kds.ring.min_late')}</small>
            </>
          ) : (
            <>
              <b>{text}</b>
              <small>{t(st.kind === 'cooking' ? 'kds.ring.cooking' : 'kds.ring.waiting')}</small>
            </>
          )}
        </span>
      </span>
    </div>
  );
}
