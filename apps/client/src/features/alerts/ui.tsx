import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { AlertFamily } from '@pos/domain';
import type { AlertCard, AlertLock, RequestOutcome } from '@pos/events';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { shownRupees } from '../owner/money';
import { closedText, familyText, fromDayText, stepTag, timeText, titleText } from './labels';
import { isSilent } from './sounds';
import type { AlertRow } from './store';

// 01d C01 / B01 / D01 building blocks in the Pulse staff layer (packages/ui-kit/components/pulse-staff.css),
// measured from the hand-off frames (docs/design/handoff/01d/design/*.dc.html). Status is icon + word + colour.

// ------------------------------------------------------------------------------------------------- icons

type Shape = { d: string } | { c: [number, number, number] } | { r: [number, number, number, number, number] };

const ICONS = {
  bell: [{ d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z' }, { d: 'M10 20.5a2 2 0 0 0 4 0' }],
  bellring: [
    { d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z' },
    { d: 'M10 20.5a2 2 0 0 0 4 0' },
    { d: 'M3 7.5a9 9 0 0 1 2.5-4' },
    { d: 'M21 7.5a9 9 0 0 0-2.5-4' },
  ],
  belloff: [{ d: 'M3 3l18 18' }, { d: 'M8.5 5.6A6 6 0 0 1 18 11v4' }, { d: 'M6 11v5.5L4.5 18h12' }, { d: 'M10 20.5a2 2 0 0 0 4 0' }],
  hand: [
    { d: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11' },
    { d: 'M11 10V4.5a1.5 1.5 0 0 1 3 0V11' },
    { d: 'M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-2.5 0-4-1-5.5-3l-2-3.2a1.5 1.5 0 0 1 2.4-1.8L8 15' },
  ],
  info: [{ c: [12, 12, 8.5] }, { d: 'M12 11v5' }, { d: 'M12 8v.01' }],
  chev: [{ d: 'M9 5l7 7-7 7' }],
  back: [{ d: 'M15 5l-7 7 7 7' }],
  down: [{ d: 'M5 9l7 7 7-7' }],
  x: [{ d: 'M6 6l12 12' }, { d: 'M18 6L6 18' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  checkc: [{ c: [12, 12, 9] }, { d: 'M8 12.5l3 3 5-6' }],
  shield: [{ d: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z' }, { d: 'M9 12l2 2 4-4' }],
  tray: [{ d: 'M3.5 13.5l2.5-8h12l2.5 8V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z' }, { d: 'M3.5 13.5h5l1 2.5h5l1-2.5h5' }],
  pulse: [{ d: 'M3 12h4l2.5-6 5 12 2.5-6h4' }],
  wifi: [{ d: 'M2.5 8.5a14 14 0 0 1 19 0' }, { d: 'M5.5 12a9.5 9.5 0 0 1 13 0' }, { d: 'M8.5 15.5a5 5 0 0 1 7 0' }, { d: 'M12 19v.01' }],
  wifioff: [{ d: 'M3 3l18 18' }, { d: 'M8 8a5 5 0 0 0-1 9.9V18h10.5' }, { d: 'M11 6.2A5.5 5.5 0 0 1 17.6 10 4 4 0 0 1 20 17' }],
  undo: [{ d: 'M9 14.5L4 9.5l5-5' }, { d: 'M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11' }],
  user: [{ c: [12, 8.5, 4] }, { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }],
  userlock: [{ c: [9, 8, 3.5] }, { d: 'M3 20a6 6 0 0 1 12 0' }, { r: [15, 10, 6.5, 6, 1] }, { d: 'M16.5 10V8.5a1.8 1.8 0 0 1 3.5 0V10' }],
  team: [{ c: [12, 5.5, 2.5] }, { c: [6, 18.5, 2.5] }, { c: [18, 18.5, 2.5] }, { d: 'M12 8v4' }, { d: 'M6 16v-2h12v2' }],
  receipt: [{ d: 'M6 3h12v18l-3-2-3 2-3-2-3 2z' }, { d: 'M9 8h6' }, { d: 'M9 12h6' }, { d: 'M9 16h3' }],
  warn: [{ d: 'M12 3.5L2.5 20h19L12 3.5z' }, { d: 'M12 10v4.5' }, { d: 'M12 17.5v.01' }],
  clock: [{ c: [12, 12, 9] }, { d: 'M12 7v5l3.5 2' }],
  repeat: [{ d: 'M17 2.5l3 3-3 3' }, { d: 'M4 11v-1.5a4 4 0 0 1 4-4h12' }, { d: 'M7 21.5l-3-3 3-3' }, { d: 'M20 13v1.5a4 4 0 0 1-4 4H4' }],
  esc: [{ d: 'M7 17l5-5 5 5' }, { d: 'M7 11l5-5 5 5' }],
  eye: [{ d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' }, { c: [12, 12, 3] }],
  lock: [{ r: [5, 10.5, 14, 10, 2] }, { d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' }],
  sync: [{ d: 'M20 11a8 8 0 0 0-14.3-4.6L4 8' }, { d: 'M4 4v4h4' }, { d: 'M4 13a8 8 0 0 0 14.3 4.6L20 16' }, { d: 'M20 20v-4h-4' }],
  signout: [{ d: 'M14 4h5v16h-5' }, { d: 'M10 8l-4 4 4 4' }, { d: 'M6 12h10' }],
  tablet: [{ r: [4, 3, 16, 18, 2] }, { d: 'M11 18h2' }],
  cash: [{ r: [3, 6, 18, 12, 2] }, { c: [12, 12, 2.8] }, { d: 'M6.5 9.5v.01M17.5 14.5v.01' }],
  pin: [{ d: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z' }, { c: [12, 10, 2.5] }],
  send: [{ d: 'M4 12L20 4l-6 16-2.5-6.5z' }, { d: 'M11.5 13.5L20 4' }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** Icons that point along the reading direction; mirrored on Urdu pages (RTL). */
const DIRECTIONAL: ReadonlySet<IconName> = new Set(['chev', 'back']);

export function Ico({ name, className }: { name: IconName; className?: string }) {
  const shapes: Shape[] = ICONS[name];
  const classes = ['ico', DIRECTIONAL.has(name) ? 'ico--dir' : null, className ?? null].filter((c) => c !== null).join(' ');
  return (
    <svg className={classes} viewBox="0 0 24 24" aria-hidden="true">
      {shapes.map((s, i) =>
        'd' in s ? (
          <path key={i} d={s.d} />
        ) : 'c' in s ? (
          <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} />
        ) : (
          <rect key={i} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4]} />
        ),
      )}
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------- tones

export type Tone = 'danger' | 'info' | 'ok' | 'warn' | 'mute' | 'brand';

interface Toned {
  kind: string;
  family: AlertFamily;
  silent?: boolean | undefined;
  outcome?: RequestOutcome | null | undefined;
}

/** DQ4: urgent red, action blue, a request result by its outcome (AD-82), every other notice neutral. */
export function toneOf(a: Toned): Tone {
  if (isSilent(a)) return 'mute';
  if (a.family === 'urgent') return 'danger';
  if (a.family === 'action') return 'info';
  if (a.kind === 'request_result') return a.outcome === 'approved' ? 'ok' : a.outcome === 'rejected' ? 'danger' : 'mute';
  if (a.kind === 'pin_use_failed') return 'warn';
  return 'mute';
}

const FAMILY_ICON: Record<AlertFamily, IconName> = { urgent: 'bellring', action: 'hand', info: 'info' };

/** DQ4 family mark: icon + word, each family its own shape; the silent kind reads "Receipt". */
export function FamilyPill({ row }: { row: Toned }) {
  const quiet = isSilent(row);
  return (
    <span className={`fam fam--${quiet ? 'silent' : row.family}`}>
      <Ico name={quiet ? 'belloff' : FAMILY_ICON[row.family]} />
      {familyText(row.family, row)}
    </span>
  );
}

export function Tag({ tone, icon, children, className }: { tone: Tone; icon: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`atag c-${tone}${className === undefined ? '' : ` ${className}`}`}>
      <Ico name={icon} />
      {children}
    </span>
  );
}

interface Tagged extends Toned {
  step: number;
  escalation: boolean;
  from_business_day?: string | null | undefined;
  for_staff_name?: string | null | undefined;
  moved_to_name?: string | null | undefined;
}

/** C01 tags: step marker, earlier day, For / Moved, Read only. */
export function Tags({ row, readOnly = false }: { row: Tagged; readOnly?: boolean }) {
  const step = stepTag(row);
  const day = fromDayText(row.from_business_day);
  return (
    <div className="ac__top">
      <FamilyPill row={row} />
      {step !== null && (
        <Tag tone={row.escalation ? 'danger' : 'warn'} icon={row.escalation ? 'esc' : 'repeat'}>
          {step}
        </Tag>
      )}
      {day !== null && (
        <Tag tone="mute" icon="clock">
          {day}
        </Tag>
      )}
      {row.for_staff_name != null && (
        <Tag tone="mute" icon="user">
          {fill(t('alerts.tag.for'), { name: row.for_staff_name })}
        </Tag>
      )}
      {row.moved_to_name != null && (
        <Tag tone="mute" icon="repeat">
          {fill(t('alerts.tag.moved'), { name: row.moved_to_name })}
        </Tag>
      )}
      {readOnly && (
        <Tag tone="mute" icon="eye">
          {t('alerts.tag.read_only')}
        </Tag>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- ring

const RING_STROKE: Record<number, number> = { 56: 5, 64: 5, 80: 5, 96: 5, 110: 6 };

export function Ring({
  size,
  pct,
  tone,
  label,
  children,
}: {
  size: 56 | 64 | 80 | 96 | 110;
  pct: number;
  tone: Tone;
  label?: string;
  children?: ReactNode;
}) {
  const stroke = RING_STROKE[size] ?? 5;
  const c = size / 2;
  const r = c - stroke / 2 - 0.5;
  const fillPct = Math.max(0, Math.min(100, pct));
  return (
    <span className={`ring ring--${size} c-${tone}`} {...(label === undefined ? {} : { role: 'img', 'aria-label': label })}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="trk" cx={c} cy={c} r={r} strokeWidth={stroke} />
        <circle className="val" cx={c} cy={c} r={r} pathLength={100} strokeWidth={stroke} strokeDasharray={`${fillPct.toFixed(1)} 100`} />
      </svg>
      <span className="ring__in">{children}</span>
    </span>
  );
}

/** The waiting ring fills over this time (no escalation time is on the wire; proposed AD, unattended). */
export const RING_FULL_MS = 4 * 60_000;

/** C01 waiting ring: minutes inside, "1d" for an earlier business day; the family icon for a notice. */
export function WaitRing({ row, nowMs, size }: { row: AlertRow | RowLike; nowMs: number; size: 56 | 64 }) {
  const tone = toneOf(row);
  const earlier = row.from_business_day != null;
  const waited = Math.max(0, nowMs - row.raised_at);
  const minutes = Math.floor(waited / 60_000);
  if (row.family !== 'urgent' && !earlier) {
    return (
      <Ring size={size} pct={100} tone={tone}>
        <Ico name={FAMILY_ICON[row.family]} />
      </Ring>
    );
  }
  return (
    <Ring size={size} pct={earlier ? 100 : (waited / RING_FULL_MS) * 100} tone={tone} label={fill(t('alerts.waiting'), { n: String(minutes) })}>
      <span className={`wt c-${tone}`}>
        <b>{earlier ? fill(t('alerts.days'), { n: '1' }) : minutes}</b>
        {!earlier && <small>{t('alerts.min')}</small>}
      </span>
    </Ring>
  );
}

// ------------------------------------------------------------------------------------------------- rows

/** The fields C01 reads from any row shape (store row, requests-to-answer row). */
export interface RowLike extends Tagged {
  alert_id: string;
  lock: AlertLock;
  card?: AlertCard | undefined;
  raised_at: number;
  answers?: readonly string[] | null | undefined;
  state?: 'open' | 'closed' | undefined;
  close_reason?: AlertRow['close_reason'] | undefined;
  decision?: AlertRow['decision'] | undefined;
  by_name?: string | null | undefined;
  seen_by_me?: boolean | undefined;
}

/** A request: it has answers, or is urgent (lock views carry no `answers`, AD-23). */
export function isRequest(row: { family: AlertFamily; answers?: readonly string[] | null | undefined }): boolean {
  return (row.answers?.length ?? 0) > 0 || row.family === 'urgent';
}

/** The table chip "T12" from the lock-safe display (empty for test alerts and warnings). */
export function tableOf(row: { lock: AlertLock; card?: AlertCard | undefined }): string | null {
  const code = (row.card ?? row.lock).table_code ?? null;
  return code === null || code === '' ? null : fill(t('alerts.table'), { code });
}

function requesterOf(row: { lock: AlertLock; card?: AlertCard | undefined }): string | null {
  const name = (row.card ?? row.lock).requester_name ?? null;
  return name === null || name === '' ? null : name;
}

/** "from <b>Hamza</b> · 2:02 PM" (C01 who line). */
export function FromLine({ row, utcOffsetMs, time = true, children }: { row: RowLike; utcOffsetMs: number; time?: boolean; children?: ReactNode }) {
  const name = requesterOf(row);
  const [before, after = ''] = t('alerts.from').split('{name}');
  return (
    <div className="ac__who">
      {name !== null && (
        <>
          {before}
          <b>{name}</b>
          {after}
        </>
      )}
      {time && (
        <>
          {name !== null && ' · '}
          <span className="num">{timeText(row.raised_at, utcOffsetMs)}</span>
        </>
      )}
      {children}
    </div>
  );
}

/** C01 details, card only (§3.12): "Chicken Karahi — Full ×1 · “Customer changed mind”" (amount on the end). */
export function detailLine(card: AlertCard | undefined, withAmount: boolean): ReactNode | null {
  const d = card?.details;
  if (d === null || d === undefined) return null;
  const parts: ReactNode[] = [];
  if (d.item !== undefined) {
    parts.push(
      <span key="i">
        {d.item}
        {d.quantity !== undefined && (
          <>
            {' '}
            <span className="num">×{d.quantity}</span>
          </>
        )}
      </span>,
    );
  }
  if (withAmount && d.amount !== undefined) parts.push(<span key="a" className="num">{amountText(d.amount)}</span>);
  if (!withAmount && d.reason !== undefined && d.reason !== '') parts.push(<span key="r">“{d.reason}”</span>);
  if (parts.length === 0) return null;
  return parts.flatMap((p, i) => (i === 0 ? [p] : [' · ', p]));
}

export function amountText(minor: number): string {
  return fill(t('alerts.amount'), { amount: shownRupees(minor) });
}

const activate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

/** C01 open card (.ac): open requests and action alerts. The whole card is the tap target. */
export function OpenCard({
  row,
  nowMs,
  utcOffsetMs,
  readOnly = false,
  onOpen,
}: {
  row: RowLike;
  nowMs: number;
  utcOffsetMs: number;
  readOnly?: boolean;
  onOpen: () => void;
}) {
  const tone = toneOf(row);
  const fresh = row.seen_by_me === false;
  const table = tableOf(row);
  const amount = row.card?.details?.amount;
  const det = detailLine(row.card, false);
  return (
    <article
      className={`ac c-${tone}${fresh ? ' is-new' : ''}${readOnly ? ' is-ro' : ''}`}
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={activate(onOpen)}
      data-alert={row.alert_id}
    >
      {fresh && <span className="ac__new" aria-label={t('alerts.new')} />}
      <div className="ac__lead">
        <WaitRing row={row} nowMs={nowMs} size={64} />
      </div>
      <div className="ac__body">
        <Tags row={row} readOnly={readOnly} />
        <div className="ac__title">
          {table !== null && <span className="tcode tcode--sm">{table}</span>}
          <b>{titleText(row)}</b>
        </div>
        <FromLine row={row} utcOffsetMs={utcOffsetMs} />
        {det !== null && <div className="ac__det">{det}</div>}
      </div>
      <div className="ac__end">
        {amount !== undefined && <span className="ac__amt num">{amountText(amount)}</span>}
        {readOnly ? (
          <span className="ac__chev">
            <Ico name="chev" />
          </span>
        ) : (
          <span className={`btn btn--tone c-${tone}`} aria-hidden="true">
            {t('alerts.answer')}
            <Ico name="chev" />
          </span>
        )}
      </div>
    </article>
  );
}

const ROW_ICON: Record<string, IconName> = {
  test_alert: 'pulse',
  approval_receipt: 'receipt',
  pin_use_failed: 'lock',
  answered_on_requester_device: 'userlock',
  no_approver: 'warn',
};

function resultIcon(row: RowLike): IconName {
  if (row.close_reason === 'withdrawn') return 'undo';
  if (row.decision === 'reject' || row.decision === 'decline') return 'x';
  return 'check';
}

/** C01 row (.ar): notices, receipts and closed alerts. Closed rows are grey with their result line. */
export function RowCard({ row, utcOffsetMs, onOpen, className }: { row: RowLike; utcOffsetMs: number; onOpen: () => void; className?: string }) {
  const tone = toneOf(row);
  const closed = row.state === 'closed';
  const fresh = !closed && row.seen_by_me === false;
  const table = tableOf(row);
  const resultTone = row.kind === 'request_result' ? toneOf(row) : tone;
  const name = requesterOf(row);
  const det = detailLine(row.card, true);
  const [before, after = ''] = t('alerts.from').split('{name}');
  return (
    <button
      type="button"
      className={`ar c-${tone}${fresh ? ' is-new' : ''}${closed ? ' is-closed' : ''}${className === undefined ? '' : ` ${className}`}`}
      onClick={onOpen}
      data-alert={row.alert_id}
    >
      <span className={`ar__ic c-${resultTone}`}>
        {row.kind === 'request_result' ? (
          <Ico name={row.outcome === 'rejected' ? 'x' : row.outcome === 'withdrawn' ? 'undo' : 'checkc'} />
        ) : table !== null && ROW_ICON[row.kind] === undefined ? (
          <span className="num">{table}</span>
        ) : (
          <Ico name={ROW_ICON[row.kind] ?? (isRequest(row) ? 'bellring' : 'info')} />
        )}
      </span>
      <span className="ar__m">
        <span className="ar__t">
          <FamilyPill row={row} />
          <span>{titleText(row)}</span>
        </span>
        <span className="ar__s">
          {closed && isRequest(row) ? (
            <span className="ar__res">
              <Ico name={resultIcon(row)} />
              {closedText({ close_reason: row.close_reason ?? null, decision: row.decision ?? undefined, by_name: row.by_name }, utcOffsetMs)}
            </span>
          ) : det !== null ? (
            <>
              {table !== null && (
                <>
                  <span className="num">{table}</span> ·{' '}
                </>
              )}
              {det}
            </>
          ) : name !== null ? (
            <>
              {before}
              <b>{name}</b>
              {after}
            </>
          ) : (
            (row.card ?? row.lock).device_name ?? ''
          )}
        </span>
      </span>
      <span className="ar__e">
        <span className="num">{timeText(row.raised_at, utcOffsetMs)}</span>
        <Ico name="chev" />
      </span>
    </button>
  );
}

// ------------------------------------------------------------------------------------------------- dialog

/**
 * D01 / D04 layer (.scrim + .dlg): a centred dialog, or a bottom sheet on portrait and the phone. Rendered inside
 * the .pu root (the kit's rules apply only there). Escape closes; focus moves into the dialog and back after.
 */
export function Dialog({
  sheet,
  labelledBy,
  onClose,
  children,
  className,
}: {
  sheet: boolean;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]');
    first?.focus();
    return () => before?.focus?.();
  }, []);
  return (
    <div
      className={`scrim${sheet ? ' scrim--sheet' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div ref={ref} className={`dlg${className === undefined ? '' : ` ${className}`}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {sheet && <span className="dlg__grip" />}
        {children}
      </div>
    </div>
  );
}

export function CloseX({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
      <Ico name="x" />
    </button>
  );
}

/** One-line message in a dialog (B03 / B04): danger or warn tint, icon + words. */
export function Msg({ tone, icon, text }: { tone: Tone; icon: IconName; text: string }) {
  return (
    <div className={`msg c-${tone}`} role="alert">
      <Ico name={icon} />
      <span>{text}</span>
    </div>
  );
}

/** The person's initial for the .av tiles. */
export function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}
