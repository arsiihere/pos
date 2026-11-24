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
import { MONEY_DIR, money } from '../money';
import { WaitingRows } from '../queue/WaitingToSend';
import type { TokenBook } from './book';
import { buildQueue, knownOrders, matchesQuery, type QueueModel, type QueueToken } from './queue-model';
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
    if (!answer.ok) return setFailed(true);
    for (const r of answer.data.orders) seen.current.set(r.order_id, r);
    setFailed(false);
    setRows(answer.data.orders);
    setLoadedAt(shellRef.current.clock.nowMs());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load());
  const version = useSyncExternalStore(book.subscribe, book.version);
  const model = useMemo(() => (rows === null ? null : buildQueue(knownOrders(rows, seen.current, book.get))), [rows, book, version]);
  return { model, failed, loadedAt, retry: () => void load() };
}

const NO_FRAMES: ReadonlySet<string> = new Set();

/** A ready tile that owes money: all ready (not part given) and not paid. */
const dueReady = (q: QueueToken) => !q.part && !q.paid;

/**
 * 02b-TK R2 (05 v1.0.34 §6.1, §6.2; frame ReadyTiles): what each Due ready tile still owes — ONE `open-bills` read for
 * the whole rail (no read per tile), only while a Due ready tile is shown and the person holds take-payment (the
 * query's permission), again (debounced) on bill / order / table frames, a reconnect and the page returning. A takeaway
 * row is one per bill_key, its `order_id` the key's root unbilled order, so a token finds its row by any of its orders;
 * owed = the open remainder at the default class less what is paid. Keyed by order id.
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
    for (const b of answer.data.bills) if (b.order_type === 'takeaway' && b.order_id !== null) next.set(b.order_id, Math.max(0, b.total_default_minor - b.paid_minor));
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
}

function ReadyTile({ q, selected, owed, onOpen, onHandOver, onPay }: { q: QueueToken; selected: boolean; owed: number | null; onOpen(): void; onHandOver?: (() => void) | undefined; onPay?: (() => void) | undefined }) {
  const shell = useShell();
  const cls = ['tk-rt', q.part ? 'tk-rt--part' : q.paid ? null : 'tk-rt--due', selected ? 'is-sel' : null].filter((c) => c !== null).join(' ');
  // R2: a paid, all-ready token hands over in one tap; a due one only offers Take payment; part given opens the view
  const act = q.part ? undefined : q.paid ? onHandOver : onPay;
  const actText = q.part ? (
    <>
      {t('q.part')}{' '}
      {q.promise_ms !== null && (
        <span className="time" dir="ltr">
          {timeText(q.promise_ms, shell.clock.utcOffsetMs)}
        </span>
      )}
    </>
  ) : (
    t(q.paid ? 'q.collect' : 'q.collect_pay')
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
      </button>
      {act === undefined ? (
        <span className="tk-rt__act">{actText}</span>
      ) : (
        <button type="button" className="tk-rt__act" onClick={act}>
          {actText}
        </button>
      )}
    </div>
  );
}

function QueueRow({ q, selected, onOpen }: { q: QueueToken; selected: boolean; onOpen(): void }) {
  const shell = useShell();
  return (
    <button type="button" className={selected ? 'tk-qr is-sel' : 'tk-qr'} aria-pressed={selected} onClick={onOpen} data-token={q.key}>
      <span className="tk-tok" dir="ltr">
        {q.token ?? '—'}
      </span>
      <span className="tk-qr__m">
        <b dir="auto">{q.customer_name ?? t('order.takeaway')}</b>
        {q.summary !== '' && <small dir="auto">{q.summary}</small>}
      </span>
      <span className="tk-qr__r">
        {q.promise_ms !== null && (
          <span className="time" dir="ltr">
            {timeText(q.promise_ms, shell.clock.utcOffsetMs)}
          </span>
        )}
        <span className={`tk-chip ${q.paid ? 'tk-chip--ok' : 'tk-chip--danger'}`}>{t(q.paid ? 'q.paid' : 'q.due')}</span>
      </span>
    </button>
  );
}

export function QueueRail({ variant, book, selected, onOpen, heldCount, onHandOver, onPay, hidden }: QueueRailProps) {
  const shell = useShell();
  const { model, failed, loadedAt, retry } = useTakeawayQueue(book);
  const owed = useDueAmounts(model);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const pick = (list: QueueToken[]) => list.filter((q) => !(hidden?.has(q.key) ?? false) && matchesQuery(q, query));
  const ready = pick(model?.ready ?? []);
  const cooking = pick(model?.cooking ?? []);
  const later = pick(model?.later ?? []);
  const open = (q: QueueToken) => {
    setAll(false);
    onOpen(q);
  };
  const tiles = ready.map((q) => (
    <ReadyTile
      key={q.key}
      q={q}
      selected={selected === q.key}
      owed={owedBy(q, owed)}
      onOpen={() => open(q)}
      onHandOver={onHandOver === undefined ? undefined : () => onHandOver(q)}
      onPay={onPay === undefined ? undefined : () => onPay(q)}
    />
  ));

  if (variant === 'strip' && !all)
    return (
      <div className="tk-rstrip" role="region" aria-label={t('q.ready')}>
        {tiles}
        <button type="button" className="tk-rstrip__q" onClick={() => setAll(true)}>
          <span>
            {t('q.all')} · <span className="num">{(model?.ready.length ?? 0) + (model?.cooking.length ?? 0) + (model?.later.length ?? 0)}</span>
          </span>
          <small>
            <span className="num">{model?.cooking.length ?? 0}</span> {t('q.cooking')}
          </small>
        </button>
      </div>
    );

  const empty = model !== null && model.ready.length + model.cooking.length + model.later.length === 0;
  const body = (
    <>
      <div className="tk-q__top">
        <label className="tk-search" role="search">
          <Ico name="eye" />
          <input type="search" value={query} placeholder={t('q.search')} aria-label={t('q.search')} onChange={(e) => setQuery(e.target.value)} />
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
            <div className="tk-ready">{tiles}</div>
          </>
        )}
        <WaitingRows />
        {cooking.length > 0 && (
          <>
            <div className="tk-sec">
              <Ico name="pulse" />
              {t('q.cooking')}
              <span className="tk-chip num">{cooking.length}</span>
            </div>
            {cooking.map((q) => (
              <QueueRow key={q.key} q={q} selected={selected === q.key} onOpen={() => open(q)} />
            ))}
          </>
        )}
        {later.length > 0 && (
          <>
            <div className="tk-sec">
              <Ico name="clock" />
              {t('q.later')}
              <span className="tk-chip tk-chip--info num">{later.length}</span>
            </div>
            {later.map((q) => (
              <QueueRow key={q.key} q={q} selected={selected === q.key} onOpen={() => open(q)} />
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
        <button type="button" className="tk-scrim--fixed" aria-label={t('common.close')} onClick={() => setAll(false)} />
        <aside className="tk-drawer tk-q" role="dialog" aria-label={t('q.all')}>
          {body}
        </aside>
      </>
    );
  return (
    <aside className={variant === 'tab' ? 'tk-q tk-q--tab' : 'tk-q'} aria-label={t('q.all')}>
      {body}
    </aside>
  );
}
