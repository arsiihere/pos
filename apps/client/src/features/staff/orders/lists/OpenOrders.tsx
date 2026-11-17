import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { useShell, type Shell } from '../../shell/hooks';
import type { LiveBus, LiveMessage } from '../../shell/live';
import { tableHref } from '../../shell/routes';
import type { CatchUpOrder, OpenOrder, OrdersCatchUp } from '../contracts';
import { OpenOrdersRow, type RowFacts } from './OpenOrdersRow';

// 02b v1.0.11 §8 Open orders, §6.16 (inventory 02-S07; frames OpenOrdersKiosk, OpenOrdersAbandoned, OpenOrdersPhone),
// #/orders: takeaway by token, parking by plate; Ready n/m; "from <date>"; by promise. The Abandoned tab is for
// managers (branch-scope force-release-table-lock; a caller outside it asking `abandoned` is a 403, §6.16).
// Q-6: refetched once (debounced) on any order frame, stage frames included; no Refresh line, "Updated {time}" only
// while offline. Q-9: who placed it and a dine-in row's table come from the hub row (H4) or, until it lands, from
// the catch-up `placed_by` id + staff-roster and the map tile; the customer's name only from what the kiosk / the
// placer receives (catch-up, OrderContactSet).

export const REFETCH_MS = 250;

/** Order frames (02b §6.19) plus the kitchen stage frames Q-6 registers for staff sockets: each refreshes open views. */
const ORDER_FRAMES = new Set([
  'OrderPlaced',
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
  'ItemStarted',
  'ItemDone',
  'ItemDoneUndone',
  'FireDispatched',
]);

/** Q-5 / Q-6: one `refetch()` per burst of order frames, a catch-up, a reconnect or the page becoming visible. */
export function useLiveRefetch(live: LiveBus, refetch: () => void, frames: ReadonlySet<string> = ORDER_FRAMES): void {
  const ref = useRef(refetch);
  ref.current = refetch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        ref.current();
      }, REFETCH_MS);
    };
    const off = live.subscribe((m: LiveMessage) => {
      if (m.kind === 'event' ? frames.has(m.event.event_type) : true) later();
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [live, frames]);
}

type Filter = 'all' | 'takeaway' | 'parking' | 'abandoned';

const byPromise = (a: OpenOrder, b: OpenOrder) => (a.promise_ms ?? Infinity) - (b.promise_ms ?? Infinity) || a.placed_at - b.placed_at;

function isManager(shell: Shell): boolean {
  return shell.permissions.allowed('force-release-table-lock') && shell.permissions.scope('force-release-table-lock') === 'branch';
}

/** The open-orders list with its filter; `KioskHome` mounts the same card. */
export function OpenOrdersCard() {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const manager = isManager(shell);
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<OpenOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [contacts, setContacts] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [placers, setPlacers] = useState<ReadonlyMap<string, string>>(new Map());
  const [roster, setRoster] = useState<ReadonlyMap<string, string>>(new Map());
  const [tableNames, setTableNames] = useState<{ byId: ReadonlyMap<string, string>; bySeating: ReadonlyMap<string, { name: string; table_id: string }> } | null>(null);

  // customer names and the catch-up's placer ids: what this device was sent (kiosk and placer only, O17)
  useEffect(() => {
    const seed = (part: unknown) => {
      const orders: CatchUpOrder[] = (part as Partial<OrdersCatchUp> | undefined)?.orders ?? [];
      setContacts((c) => new Map([...c, ...orders.filter((o) => o.customer_name !== undefined).map((o) => [o.order_id, o.customer_name ?? null] as const)]));
      setPlacers((p) => new Map([...p, ...orders.map((o) => [o.order_id, o.placed_by] as const)]));
    };
    seed(shell.live.part('orders'));
    return shell.live.subscribe((m) => {
      if (m.kind === 'catch_up') seed(m.state['orders']);
      if (m.kind === 'event' && m.event.event_type === 'OrderContactSet') {
        const p = m.event.payload as { order_id?: string; customer_name?: string | null };
        if (typeof p.order_id === 'string') setContacts((c) => new Map(c).set(p.order_id as string, p.customer_name ?? null));
      }
    });
  }, [shell.live]);

  // each read replaces the list; a reply older than the last request is dropped
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    const answer = await shellRef.current.orders.openOrders({ order_type: 'all', abandoned: manager });
    if (mine !== request.current) return;
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRows(answer.data.orders);
    setLoadedAt(shellRef.current.clock.nowMs());
  }, [manager]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load());

  // names the hub row does not carry yet (H4 absent): the roster once, the map once for a dine-in row
  const needRoster = (rows ?? []).some((r) => r.placed_by?.name === undefined || r.placed_by.name === null);
  useEffect(() => {
    if (!needRoster || roster.size > 0) return;
    let live = true;
    void shellRef.current.api.roster().then((a) => {
      if (live && a.ok) setRoster(new Map(a.data.staff.map((s) => [s.staff_id, s.display_name])));
    });
    return () => {
      live = false;
    };
  }, [needRoster, roster.size]);
  const needTables = (rows ?? []).some((r) => r.order_type === 'dine_in');
  useEffect(() => {
    if (!needTables || tableNames !== null) return;
    let live = true;
    void shellRef.current.tables.tableMap().then((a) => {
      if (!live || !a.ok) return;
      const byId = new Map<string, string>();
      const bySeating = new Map<string, { name: string; table_id: string }>();
      for (const f of a.data.floors)
        for (const z of f.zones)
          for (const tile of z.tables) {
            byId.set(tile.table_id, tile.name);
            if (tile.seating_id !== null) bySeating.set(tile.seating_id, { name: tile.name, table_id: tile.table_id });
          }
      setTableNames({ byId, bySeating });
    });
    return () => {
      live = false;
    };
  }, [needTables, tableNames]);

  const counts = useMemo(() => {
    const own = (rows ?? []).filter((r) => r.order_type !== 'dine_in');
    return {
      all: own.length,
      takeaway: own.filter((r) => r.order_type === 'takeaway').length,
      parking: own.filter((r) => r.order_type === 'parking').length,
      abandoned: (rows ?? []).filter((r) => r.abandoned).length,
    };
  }, [rows]);
  const shown = useMemo(() => {
    const list = rows ?? [];
    const pick =
      filter === 'abandoned' ? list.filter((r) => r.abandoned) : list.filter((r) => r.order_type !== 'dine_in' && (filter === 'all' || r.order_type === filter));
    return [...pick].sort(byPromise);
  }, [rows, filter]);
  // a manager who loses the grant while on the tab falls back to All
  const active: Filter = filter === 'abandoned' && !manager ? 'all' : filter;

  const abandonMs = shell.config.config()?.order_abandon_ms ?? null;
  const tapHours = abandonMs === null ? null : Math.max(1, Math.floor(abandonMs / 3_600_000));
  const seatingOf = (r: OpenOrder) => r.table_key.replace(/^dine_in:/, '');
  const tableOf = (r: OpenOrder): { name: string | null; table_id: string | null } => {
    if (typeof r.table_id === 'string') return { name: tableNames?.byId.get(r.table_id) ?? null, table_id: r.table_id };
    const tile = tableNames?.bySeating.get(seatingOf(r));
    return { name: tile?.name ?? null, table_id: tile?.table_id ?? null };
  };
  const factsOf = (r: OpenOrder): RowFacts => {
    const placerId = r.placed_by?.staff_id ?? placers.get(r.order_id);
    return {
      customer: contacts.get(r.order_id) ?? null,
      placer: r.placed_by?.name ?? (placerId === undefined ? null : (roster.get(placerId) ?? null)),
      table: tableOf(r).name,
      tapHours: r.abandoned ? tapHours : null,
    };
  };
  const open = (r: OpenOrder) => {
    if (r.order_type !== 'dine_in') return navigate(`/orders/${encodeURIComponent(r.order_id)}`);
    const { table_id } = tableOf(r);
    navigate(table_id === null ? '/tables' : tableHref(table_id, seatingOf(r)));
  };

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: 'all', label: t('orders.filter_all'), n: counts.all },
    { id: 'takeaway', label: t('order.takeaway'), n: counts.takeaway },
    { id: 'parking', label: t('order.parking'), n: counts.parking },
    ...(manager ? [{ id: 'abandoned' as const, label: t('orders.abandoned'), n: counts.abandoned }] : []),
  ];
  const list = (
    <>
      {rows === null && !failed && <p className="muted">{t('common.loading')}</p>}
      {failed && (
        <div className="msg c-danger" role="alert">
          <Ico name="warn" />
          <span>{t('orders.load_failed')}</span>
          <button type="button" className="btn" onClick={() => void load()}>
            {t('orders.retry')}
          </button>
        </div>
      )}
      {rows !== null && shown.length === 0 && <p className="muted">{t('orders.empty')}</p>}
      {shown.map((r) => (
        <OpenOrdersRow key={r.order_id} order={r} facts={factsOf(r)} utcOffsetMs={shell.clock.utcOffsetMs} onOpen={() => open(r)} />
      ))}
    </>
  );
  const offline = !shell.online && loadedAt !== null ? <span className="muted">{fill(t('tv.updated'), { time: timeText(loadedAt, shell.clock.utcOffsetMs) })}</span> : null;

  if (shell.phone)
    return (
      <>
        <div className="chipsx">
          {tabs.map((x) => (
            <button key={x.id} type="button" className="chip" aria-pressed={active === x.id} onClick={() => setFilter(x.id)}>
              {x.label} <small>{x.n}</small>
            </button>
          ))}
        </div>
        {offline}
        {list}
      </>
    );
  return (
    <section className="lcard">
      <div className="lcard__h">
        <h2>{t('orders.open')}</h2>
        <span className="end">
          {offline}
          <div className="on-light">
            <div className="seg" role="group" aria-label={t('orders.open')}>
              {tabs.map((x) => (
                <button key={x.id} type="button" aria-pressed={active === x.id} onClick={() => setFilter(x.id)}>
                  {x.label} <span className="n num">{x.n}</span>
                </button>
              ))}
            </div>
          </div>
        </span>
      </div>
      <div className="lcard__b">{list}</div>
    </section>
  );
}

/** #/orders: the list on its own (tablet, phone Orders tab). */
export function OpenOrders() {
  const shell = useShell();
  if (shell.phone)
    return (
      <div className="ph-body">
        <OpenOrdersCard />
      </div>
    );
  return (
    <main className="map map--one">
      <OpenOrdersCard />
    </main>
  );
}
