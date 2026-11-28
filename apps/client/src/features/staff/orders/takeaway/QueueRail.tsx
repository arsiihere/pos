import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigate } from '../../../../app/router';
import { t } from '../../../../i18n';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { billingApi } from '../../../billing/api';
import { BILL_LIST_FRAMES } from '../../../billing/frames';
import { useShell } from '../../shell/hooks';
import type { OpenOrder } from '../contracts';
import { useLiveRefetch } from '../lists/OpenOrders';
import { businessDayText } from '../lists/OpenOrdersRow';
import { MONEY_DIR, money } from '../money';
import { useWaitingTakeaways, WaitingRows } from '../queue/WaitingToSend';
import { contactGaps, type TokenBook } from './book';
import { billsOf, buildQueue, knownOrders, matchesQuery, notCollectedMinOf, type QueueModel, type QueueToken } from './queue-model';
import { AskManager } from '../unpaid/AskManager';
import { checkWholeToken, gatesOf, type HandoverCheck } from '../unpaid/candidate';
import { unpaidRequestsOf } from '../unpaid/requests';
import { slipMissesOf } from './slips';
import './styles';

// 02b-TK C2-1 (02b v1.0.24 §6.16, §8; frames HomeKiosk, ReadyTiles, QueueTablet, PhoneQueue; CHANGES §1; R3): the
// takeaway queue rail beside the menu and the cart — search, Ready — hand over (tiles), Cooking (rows by time, the
// queued "Waiting to send" rows first), Phone orders — later, and at the foot Held (n) and All orders. One
// `open-orders` read, again (debounced) on order frames, a reconnect and the page becoming visible; the names and
// phones come only from what the kiosk was sent (catch-up, OrderContactSet: book.ts), never asked of the hub (R3).
// Kiosk: a column; a landscape tablet: the ready strip with the whole queue behind "All orders"; phone: the Queue tab.

export type RailVariant = 'column' | 'strip' | 'tab';

/** The rail's data: the open-orders read, the rows seen before, and the book. */
export function useTakeawayQueue(book: TokenBook): { model: QueueModel | null; failed: boolean; loadedAt: number | null; retry(): void } {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [rows, setRows] = useState<OpenOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const seen = useRef(new Map<string, OpenOrder>());
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    let answer: Awaited<ReturnType<typeof shellRef.current.orders.openOrders>>;
    try {
      answer = await shellRef.current.orders.openOrders({ order_type: 'takeaway' });
    } catch {
      answer = { ok: false, error: { kind: 'network' } };
    }
    if (mine !== request.current) return;
    if (!answer.ok) {
      // BUG-12: a refused read (signed out, forbidden, a bad reply) drops what the rail showed — the last rows are
      // never shown as current. A lost network keeps them, marked "as of" (02b §8 offline)
      if (answer.error.kind !== 'network') {
        seen.current.clear();
        setRows(null);
      }
      return setFailed(true);
    }
    for (const r of answer.data.orders) seen.current.set(r.order_id, r);
    // 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §6.16 R3-M-8): the rows' approval flags feed the page's approvals
    unpaidRequestsOf(shellRef.current).seed(answer.data.orders);
    setFailed(false);
    setRows(answer.data.orders);
    setLoadedAt(shellRef.current.clock.nowMs());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load());
  const version = useSyncExternalStore(book.subscribe, book.version);
  // ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16, §8): a later pickup moves to the now queue once hub now passes it
  const nowMs = useHubNow(rows?.some((r) => r.effective_pickup_at_ms != null) ?? false);
  const tick = Math.floor(nowMs / LATE_TICK_MS);
  const model = useMemo(() => (rows === null ? null : buildQueue(knownOrders(rows, seen.current, book.get), shellRef.current.clock.nowMs())), [rows, book, version, tick]);
  useContactResync(rows, book);
  return { model, failed, loadedAt, retry: () => void load() };
}

/**
 * ⚠️ 02b v1.0.28 QK-6 (BUG-23): the strip's "All orders · n" and "n Cooking" count what the queue lists — the takeaways
 * waiting to send in the device queue are Cooking rows (as the rail's Cooking section counts them).
 */
export function stripCounts(model: Pick<QueueModel, 'ready' | 'cooking' | 'later'> | null, waiting: number): { all: number; cooking: number } {
  const cooking = (model?.cooking.length ?? 0) + waiting;
  return { all: (model?.ready.length ?? 0) + cooking + (model?.later.length ?? 0), cooking };
}

/** BUG-5: how long a contact gap may last (a frame on its way) before the live state is read again */
export const CONTACT_GAP_MS = 2_000;

/**
 * BUG-5 (QA round 2; 02b v1.0.28 §8 "Contact on this device"): never show a person masked data they may see. A row
 * whose name / phone the hub sends this device (`contactGaps`) but the book lacks after CONTACT_GAP_MS → one re-read
 * (`shell.resync`, a fresh catch-up); the same orders are never asked twice (a hub that does not send them is not
 * asked in a loop).
 */
function useContactResync(rows: OpenOrder[] | null, book: TokenBook): void {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const asked = useRef(new Set<string>());
  useSyncExternalStore(book.subscribe, book.version);
  const gapsNow = (): string[] => {
    const sh = shellRef.current;
    if (rows === null || sh.resync === undefined) return [];
    return contactGaps(rows, book, { kiosk: sh.device.type === 'cashier_kiosk', staffId: sh.me?.staff_id ?? null }).filter((id) => !asked.current.has(id));
  };
  const check = useRef(gapsNow);
  check.current = gapsNow;
  const key = gapsNow().join(',');
  useEffect(() => {
    if (key === '') return;
    const timer = setTimeout(() => {
      const still = check.current();
      if (still.length === 0) return;
      for (const id of still) asked.current.add(id);
      shellRef.current.resync?.();
    }, CONTACT_GAP_MS);
    return () => clearTimeout(timer);
  }, [key]);
}

const NO_FRAMES: ReadonlySet<string> = new Set();

/** ⚠️ 03b v1.0.16 §3.4 (R3-M-9): how often a ready tile / the token drawer re-checks the not-collected clock */
export const LATE_TICK_MS = 15_000;

/** The hub clock, re-read every LATE_TICK_MS while `on` (02b-TK L-CLIENT-2 item 2: the amber Ready tile and drawer). */
export function useHubNow(on: boolean): number {
  const shell = useShell();
  const clock = useRef(shell.clock);
  clock.current = shell.clock;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((n) => n + 1), LATE_TICK_MS);
    return () => clearInterval(timer);
  }, [on]);
  return clock.current.nowMs();
}

/** ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16; D1): "Pickup 2:00 PM" of a pickup token (kept after a boost). */
export function PickupLine({ q, utcOffsetMs }: { q: Pick<QueueToken, 'pickup_at_ms'>; utcOffsetMs: number }) {
  if (q.pickup_at_ms == null) return null;
  return (
    <small className="c-info" data-pickup="">
      {t('c.pickup')}{' '}
      <span className="time" dir="ltr">
        {timeText(q.pickup_at_ms, utcOffsetMs)}
      </span>
    </small>
  );
}

/**
 * ⚠️ 02b v1.0.25 §6.16 `planned_ready_at_ms` (owner ruling BR-1; 03a PK-5): the token's time — "Ready ~1:35 PM" with
 * the stored promise struck through beside it when `planned` (plannedReadyOf) is earlier than the promise; otherwise the
 * promise as before. Nothing without a promise. `stack`: the struck promise on its own line (the token view's fact, so
 * a wrapped Urdu line never runs into it).
 */
export function ReadyTime({ promise, planned, utcOffsetMs, stack = false }: { promise: number | null; planned: number | null | undefined; utcOffsetMs: number; stack?: boolean }) {
  if (promise === null) return null;
  if (planned == null || planned >= promise) {
    return (
      <span className="time" dir="ltr">
        {timeText(promise, utcOffsetMs)}
      </span>
    );
  }
  const [before, after = ''] = t('q.ready_planned').split('{t}');
  return (
    <>
      <span data-planned="" dir="auto">
        {before}
        <span className="time" dir="ltr">
          {timeText(planned, utcOffsetMs)}
        </span>
        {after}
      </span>
      {stack ? <br /> : ' '}
      <s className="muted" dir="ltr" data-promise="">
        {timeText(promise, utcOffsetMs)}
      </s>
    </>
  );
}

/**
 * ⚠️ 02b-TK L-CLIENT-5 item 3 (02b v1.0.25 §3.3 Day close "57 · 6 Nov", §6.16 `from_date`; DC-2): a carried token's
 * number with its business date ("57 · 27 Nov"); null for a token of the open day.
 */
export function carriedLabel(q: Pick<QueueToken, 'token' | 'from_date'>): string | null {
  if (q.from_date == null) return null;
  return `${q.token ?? '—'} · ${businessDayText(q.from_date)}`;
}

/** The carried date beside the token (the token's own element keeps the bare number). */
export function CarriedDate({ q }: { q: Pick<QueueToken, 'token' | 'from_date'> }) {
  const label = carriedLabel(q);
  return label === null ? null : (
    <small className="c-warn" data-carried="">
      <bdi>{label}</bdi>
    </small>
  );
}

/** A ready tile that owes money: all ready (not part given) and not paid. */
const dueReady = (q: QueueToken) => !q.part && !q.paid;

/**
 * 02b-TK R2 (05 v1.0.34 §6.1, §6.2; frame ReadyTiles): what each Due ready tile still owes — ONE `open-bills` read for
 * the whole rail (no read per tile), only while a Due ready tile is shown and the person holds take-payment (the
 * query's permission), again (debounced) on bill / order / table frames, a reconnect and the page returning. A takeaway
 * row is one per bill_key, its `order_id` the key's root unbilled order, so a token finds its row by any of its orders;
 * owed = the row's due_minor (⚠️ 05 v1.0.35 §6.2, D3: Σ the open splits' balances, never total − paid). Keyed by order id.
 */
function useDueAmounts(model: QueueModel | null): ReadonlyMap<string, number> {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [owed, setOwed] = useState<ReadonlyMap<string, number>>(new Map());
  const wanted = shell.permissions.allowed('take-payment') && (model?.ready.some(dueReady) ?? false);
  // a new Due ready tile reads again (its bill may be newer than the last read)
  const dueKeys = wanted ? model!.ready.filter(dueReady).map((q) => q.key).join(' ') : '';
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    let answer: Awaited<ReturnType<ReturnType<typeof billingApi>['openBills']>>;
    try {
      answer = await billingApi(shellRef.current.api).openBills();
    } catch {
      return;
    }
    if (mine !== request.current || !answer.ok) return;
    const next = new Map<string, number>();
    for (const b of answer.data.bills) if (b.order_type === 'takeaway' && b.order_id !== null) next.set(b.order_id, Math.max(0, b.due_minor));
    setOwed(next);
  }, []);
  useEffect(() => {
    if (dueKeys !== '') void load();
  }, [dueKeys, load]);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;
  useLiveRefetch(shell.live, () => (wantedRef.current ? void load() : undefined), wanted ? BILL_LIST_FRAMES : NO_FRAMES);
  return owed;
}

/** The amount a token owes: its row by its newest order first (05 #44e: a new bill on the same key). */
function owedBy(q: QueueToken, owed: ReadonlyMap<string, number>): number | null {
  for (const id of [...q.order_ids].reverse()) {
    const n = owed.get(id);
    if (n !== undefined) return n;
  }
  return null;
}

export interface QueueRailProps {
  variant: RailVariant;
  book: TokenBook;
  /** the token whose view is open (its tile / row is selected) */
  selected: string | null;
  onOpen(token: QueueToken): void;
  heldCount: number;
  /** 02b-TK C2-2 (frame ReadyTiles): a paid ready tile's one-tap Hand over (5 s Undo); absent → the tile opens the view */
  onHandOver?: ((token: QueueToken) => void) | undefined;
  /** a due ready tile's Take payment */
  onPay?: ((token: QueueToken) => void) | undefined;
  /** tokens handed over in the Undo window: not shown */
  hidden?: ReadonlySet<string>;
  /** 02b-TK A2 item 4 (R9): the open takeaway tokens the rail holds, for rush mode (each read) */
  onCount?: ((n: number) => void) | undefined;
  /** 02b-TK A2 item 4 (frame HomeRush): the compact queue */
  compact?: boolean;
  /** qa1-fix (T1 #12): a successful read no longer lists the selected token (cancelled, or handed over in full) */
  onGone?: ((key: string) => void) | undefined;
}

function ReadyTile({ q, selected, owed, late, whole, onOpen, onHandOver, onPay }: { q: QueueToken; selected: boolean; owed: number | null; late: number | null; whole: HandoverCheck; onOpen(): void; onHandOver?: (() => void) | undefined; onPay?: (() => void) | undefined }) {
  const shell = useShell();
  // ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, §8 OR-7; D2): the shared check over every order of the token — a
  // Due order approved at its due (or due 0) hands over too; a Due, unapproved one offers Ask a manager for the newest
  // such order (a mixed token approves only the named order)
  const handable = q.paid || whole.ok;
  // ⚠️ 02b-TK L-CLIENT-2 item 2 (03b v1.0.16 §3.4 R3-M-9, §3.5, D8; frames ReadyTiles, TokenLate): not collected past
  // the R8 window → amber; one that may be handed over with a phone this person may see reads "{n} min · Call" and
  // opens the token (Call and Hand over all are in the drawer); a due one keeps Take payment
  const amber = late !== null && !q.part;
  const call = amber && handable && q.phone !== null;
  const cls = ['tk-rt', q.part ? 'tk-rt--part' : q.paid ? null : 'tk-rt--due', amber ? 'tk-rt--late' : null, selected ? 'is-sel' : null].filter((c) => c !== null).join(' ');
  // R2: a paid, all-ready token hands over in one tap; a due one only offers Take payment; part given opens the view
  const act = q.part ? undefined : call ? onOpen : handable ? onHandOver : onPay;
  const [minBefore, minAfter = ''] = t('q.waiting_min').split('{n}');
  const actText = call ? (
    <>
      {minBefore}
      <span className="num" dir="ltr">
        {late}
      </span>
      {minAfter}
    </>
  ) : q.part ? (
    <>
      {t('q.part')} <ReadyTime promise={q.promise_ms} planned={q.planned_ready_at_ms} utcOffsetMs={shell.clock.utcOffsetMs} />
    </>
  ) : (
    t(handable ? 'q.collect' : 'q.collect_pay')
  );
  return (
    <div className={cls} data-token={q.key}>
      <button type="button" className="tk-rt__open" aria-pressed={selected} onClick={onOpen}>
        <span className="tok" dir="ltr">
          {q.token ?? '—'}
        </span>
        <span className={`tk-chip ${q.paid ? 'tk-chip--ok' : 'tk-chip--solid-danger'}`}>
          <Ico name={q.paid ? 'check' : 'warn'} />
          {t(q.paid ? 'q.paid' : 'q.due')}
        </span>
        {dueReady(q) ? (
          // R2 (frame ReadyTiles): a Due tile shows what is owed, not the name — "Take payment first"
          <span className="tk-rt__who">
            <span className="money" dir={MONEY_DIR}>
              {owed === null ? '—' : money(owed)}
            </span>
          </span>
        ) : (
          <span className="tk-rt__who" dir="auto">
            {q.customer_name ?? t('order.takeaway')}
          </span>
        )}
        <PickupLine q={q} utcOffsetMs={shell.clock.utcOffsetMs} />
        <CarriedDate q={q} />
      </button>
      {act === undefined ? (
        <span className="tk-rt__act">{actText}</span>
      ) : (
        <button type="button" className="tk-rt__act" onClick={act}>
          {actText}
        </button>
      )}
      {!q.part && onHandOver !== undefined && !whole.ok && whole.reason === 'due' && (
        <AskManager order_id={whole.order_id} due_minor={whole.due_minor} ident={q.order_ids.length > 1 ? `#${q.token ?? '—'}` : undefined} variant="tile" />
      )}
    </div>
  );
}

function QueueRow({ q, selected, onOpen, later = false }: { q: QueueToken; selected: boolean; onOpen(): void; later?: boolean }) {
  const shell = useShell();
  const slips = slipMissesOf(shell);
  useSyncExternalStore(slips.subscribe, slips.version);
  return (
    <button type="button" className={selected ? 'tk-qr is-sel' : 'tk-qr'} aria-pressed={selected} onClick={onOpen} data-token={q.key}>
      {/* L-CLIENT-6a item 12 (frames HomeKiosk, ReadyTiles): a phone order for later shows the phone with its token */}
      <span className={later ? 'tk-tok tk-tok--phone' : 'tk-tok'} dir="ltr">
        {later && <Ico name="phone" />}
        {q.token ?? '—'}
      </span>
      <span className="tk-qr__m">
        <CarriedDate q={q} />
        <b dir="auto">{q.customer_name ?? t('order.takeaway')}</b>
        {q.summary !== '' && <small dir="auto">{q.summary}</small>}
        <PickupLine q={q} utcOffsetMs={shell.clock.utcOffsetMs} />
        {/* ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §8): the slip did not print at Send */}
        {slips.missed(q.order_ids) && (
          <small className="c-warn" data-slip="">
            {t('takeaway.slip.not_printed')}
          </small>
        )}
      </span>
      <span className="tk-qr__r">
        <ReadyTime promise={q.promise_ms} planned={q.planned_ready_at_ms} utcOffsetMs={shell.clock.utcOffsetMs} />
        <span className={`tk-chip ${q.paid ? 'tk-chip--ok' : 'tk-chip--danger'}`}>{t(q.paid ? 'q.paid' : 'q.due')}</span>
      </span>
    </button>
  );
}

export function QueueRail({ variant, book, selected, onOpen, heldCount, onHandOver, onPay, hidden, onCount, compact = false, onGone }: QueueRailProps) {
  const shell = useShell();
  const { model, failed, loadedAt, retry } = useTakeawayQueue(book);
  // qa1-fix (T1 #12; 02b §8): the open token's view closes once a read no longer lists it (its order cancelled, or the
  // token handed over in full) — never a drawer for a token that is gone
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const listed = model === null || selected === null ? true : [...model.ready, ...model.cooking, ...model.later].some((q) => q.key === selected);
  useEffect(() => {
    if (!listed && selected !== null) goneRef.current?.(selected);
  }, [listed, selected]);
  const open_n = model === null ? null : model.ready.length + model.cooking.length + model.later.length;
  const countRef = useRef(onCount);
  countRef.current = onCount;
  useEffect(() => {
    if (open_n !== null) countRef.current?.(open_n);
  }, [open_n]);
  const owed = useDueAmounts(model);
  const waiting = useWaitingTakeaways();
  // ⚠️ 03b v1.0.16 §3.4 (R3-M-9): re-check the amber clock while a ready tile has a bag-ready pair
  const nowMs = useHubNow(model?.ready.some((q) => q.late_from != null) ?? false);
  const unpaid = unpaidRequestsOf(shell);
  useSyncExternalStore(unpaid.subscribe, unpaid.version);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const seeContact = variant === 'column' || shell.permissions.allowed('view-customer-contact');
  const searchLabel = t(seeContact ? 'q.search' : 'q.search_token');
  const drawerSearch = useRef<HTMLInputElement>(null);
  const pick = (list: QueueToken[], search = true) => list
    .map((q) => seeContact ? q : { ...q, customer_name: null, phone: null })
    .filter((q) => !(hidden?.has(q.key) ?? false) && (!search || matchesQuery(q, query)));
  useEffect(() => {
    if (variant !== 'strip' || !all) return;
    drawerSearch.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setAll(false);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [variant, all]);
  const ready = pick(model?.ready ?? []);
  const cooking = pick(model?.cooking ?? []);
  const later = pick(model?.later ?? []);
  const open = (q: QueueToken) => {
    setAll(false);
    onOpen(q);
  };
  const tile = (q: QueueToken) => (
    <ReadyTile
      key={q.key}
      q={q}
      selected={selected === q.key}
      owed={owedBy(q, owed)}
      late={notCollectedMinOf(q, nowMs)}
      whole={checkWholeToken(gatesOf(billsOf(q), unpaid.approvedDue))}
      onOpen={() => open(q)}
      onHandOver={onHandOver === undefined ? undefined : () => { setAll(false); onHandOver(q); }}
      onPay={onPay === undefined ? undefined : () => { setAll(false); onPay(q); }}
    />
  );

  const strip = variant === 'strip' && (
    <div className="tk-rstrip" role="region" aria-label={t('q.ready')}>
        {pick(model?.ready ?? [], false).map(tile)}
        <button type="button" className="tk-rstrip__q" onClick={() => setAll(true)}>
          <span>
            {t('q.all')} · <span className="num">{stripCounts(model, waiting.length).all}</span>
          </span>
          <small>
            <span className="num">{stripCounts(model, waiting.length).cooking}</span> {t('q.cooking')}
          </small>
        </button>
      </div>
    );

  if (variant === 'strip' && !all) return strip;

  const empty = model !== null && model.ready.length + model.cooking.length + model.later.length === 0;
  const body = (
    <>
      <div className="tk-q__top">
        <label className="tk-search" role="search">
          <Ico name="search" />
          <input type="search" value={query} ref={variant === "strip" ? drawerSearch : undefined} placeholder={searchLabel} aria-label={searchLabel} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {!shell.online && loadedAt !== null && (
          <span className="tk-hint">
            {t('q.as_of')}{' '}
            <span className="time" dir="ltr">
              {timeText(loadedAt, shell.clock.utcOffsetMs)}
            </span>
          </span>
        )}
      </div>
      <div className="tk-q__scroll">
        {failed && (
          <div className="tk-msg tk-msg--danger" role="alert">
            <Ico name="warn" />
            <span>{t('q.failed')}</span>
            <button type="button" className="tk-btn" onClick={retry}>
              {t('q.retry')}
            </button>
          </div>
        )}
        {model === null && !failed && <p className="tk-hint">{t('common.loading')}</p>}
        {ready.length > 0 && (
          <>
            <div className="tk-sec">
              <Ico name="checkc" />
              {t('q.ready')}
              <span className="tk-chip tk-chip--ok num">{ready.length}</span>
            </div>
            <div className="tk-ready">{ready.map(tile)}</div>
          </>
        )}
        {/* L-CLIENT-6a item 4 (frames SentToast, SentQueued): the orders waiting to send head the Cooking rows */}
        {cooking.length + waiting.length > 0 && (
          <>
            <div className="tk-sec">
              <Ico name="pulse" />
              {t('q.cooking')}
              <span className="tk-chip num">{cooking.length + waiting.length}</span>
            </div>
            <WaitingRows showContact={seeContact} />
            {cooking.map((q) => (
              <QueueRow key={q.key} q={q} selected={selected === q.key} onOpen={() => open(q)} />
            ))}
          </>
        )}
        {later.length > 0 && (
          <>
            <div className="tk-sec">
              <Ico name="phone" />
              {t('q.later')}
              <span className="tk-chip tk-chip--info num">{later.length}</span>
            </div>
            {later.map((q) => (
              <QueueRow key={q.key} q={q} selected={selected === q.key} onOpen={() => open(q)} later />
            ))}
          </>
        )}
        {empty && (
          <div className="tk-empty">
            <span className="tk-empty__ic">
              <Ico name="tray" />
            </span>
            <b>{t('q.empty_t')}</b>
            <p>{t('q.empty_p')}</p>
          </div>
        )}
      </div>
      <div className="tk-q__foot">
        <button type="button" className="tk-btn" onClick={() => navigate('/held')}>
          {t('q.held')}
          {heldCount > 0 && <span className="tk-chip tk-chip--brand num">{heldCount}</span>}
        </button>
        <button type="button" className="tk-btn" onClick={() => navigate('/orders')}>
          {t('q.all')}
        </button>
      </div>
    </>
  );
  if (variant === 'strip')
    return (
      <>
        <div inert>{strip}</div>
        <button type="button" className="tk-scrim--fixed" tabIndex={-1} aria-label={t('common.close')} onClick={() => setAll(false)} />
        <aside className={'tk-drawer tk-q tk-q--drawer' + (compact ? ' tk-q--compact' : '')} role="dialog" aria-modal="true" aria-label={t('q.all')}>
          <div className="tk-drawer__h">
            <h2>{t('q.all')}</h2>
            <button type="button" className="tk-x" aria-label={t('common.close')} onClick={() => setAll(false)}><Ico name="x" /></button>
          </div>
          {body}
        </aside>
      </>
    );
  return (
    <aside className={['tk-q', variant === 'tab' ? 'tk-q--tab' : null, compact ? 'tk-q--compact' : null].filter((c) => c !== null).join(' ')} aria-label={t('q.all')}>
      {body}
    </aside>
  );
}
