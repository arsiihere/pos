import { useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { navigate, useHashRoute } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { AlertRow } from '../../../alerts/store';
import { useShell } from '../../shell/hooks';
import { tableHref } from '../../shell/routes';
import type { MapTile } from '../contracts';
import {
  callsOf,
  floorHref,
  floorOf,
  lateTables,
  needsYou,
  sectionsOf,
  stateCounts,
  tileName,
  zoneAssignee,
  type MapAlertRow,
  type MapFilter,
  type NeedsItem,
  type SlipOrders,
} from './filters';
import { sharedMapStore } from './map-store';
import { NeedsYou } from './NeedsYou';
import { MapIco, Tile } from './Tile';
import { Zone } from './Zone';

// 02a §8 Table map (02-S03; frames TableMap, Mine, Loading, Empty, Portrait, Kiosk, Phone, Urdu, Waiter): zones →
// tiles, All / Mine, Needs you with the legend, Open orders / Held, one New order. A tile tap opens #/tables/<table_id>
// with the tile's seating_id. Shown from the catch-up and the debounced `table-map` reads of map-store.ts.

export interface TableMapProps {
  /**
   * The alert store's rows (kinds `slip_warning`, `call_waiter`): the late flag and the waiter's calls (Q-17, Q-12).
   * The shell does not pass them yet (STOP in the PR); until it does the map shows neither.
   */
  alertRows?: readonly (AlertRow | MapAlertRow)[];
  /** opens 02b's New order sheet (26d) */
  onNewOrder?: () => void;
}

const NONE: readonly MapAlertRow[] = [];
const SECOND = 1_000;

/** Re-renders when any of the given stores change. */
function useChanged(...subscribes: Array<(listener: () => void) => () => void>): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const offs = subscribes.map((s) => s(bump));
    return () => offs.forEach((off) => off());
    // the subscribe functions are stable per shell
  }, subscribes);
}

export function TableMap({ alertRows = NONE, onNewOrder }: TableMapProps = {}) {
  const shell = useShell();
  const store = useMemo(() => sharedMapStore(shell.tables, shell.live), [shell.tables, shell.live]);
  const map = useSyncExternalStore(store.subscribe, store.current);
  const route = useHashRoute();
  // the sheet's route has no ?floor=: keep the floor the map was showing
  const lastFloor = useRef<string | null>(null);
  if (route.startsWith('/tables') && !route.startsWith('/tables/')) lastFloor.current = floorOf(route);
  const selected = lastFloor.current;
  useChanged(shell.enqueue.subscribe, shell.localFlags.subscribe);
  const [filter, setFilter] = useReducer((_: MapFilter, next: MapFilter) => next, 'all' as MapFilter);
  // minutes on tiles move with the clock; this repaints only, it never reads (Q-5: no polling timer)
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(repaint, 30 * SECOND);
    return () => clearInterval(id);
  }, []);

  const staffId = shell.me?.staff_id ?? null;
  const nowMs = shell.clock.nowMs();
  const role = shell.device.type === 'cashier_kiosk' ? 'cashier' : shell.permissions.allowed('take-order') ? 'taker' : 'waiter';
  const canOrder = role !== 'waiter';
  const rows = alertRows as readonly MapAlertRow[];

  const floors = (map?.floors ?? []).filter((f) => !f.archived);
  const phoneFloor = shell.phone ? (selected ?? floors[0]?.floor_id ?? null) : selected;
  const sections = sectionsOf(map, { floor_id: phoneFloor, filter, staffId });
  const scope = sectionsOf(map, { floor_id: phoneFloor, filter: 'all', staffId });
  const allTiles = scope.flatMap((s) => s.tiles);
  const orders = shell.live.part('orders') as SlipOrders | undefined;
  const late = lateTables(rows, allTiles, orders ?? null);
  const items = needsYou({ tiles: allTiles, staffId, role, nowMs, late, calls: callsOf(rows, allTiles) });
  const mineCount = allTiles.filter((x) => x.holder?.staff_id === staffId || x.assignee?.staff_id === staffId).length;

  const openTile = (tile: MapTile) => {
    if (tile.state === 'FREE' && !canOrder) {
      shell.toasts.show({ text: fill(t('tables.toast.free'), { table: tileName(tile) }), tone: 'info' });
      return;
    }
    navigate(tableHref(tile.table_id, tile.seating_id));
  };
  const openItem = (item: NeedsItem) => navigate(tableHref(item.table_id, item.seating_id));

  const filterButtons = (
    <div className="seg seg--fill" role="group" aria-label={t('tables.filter.all')}>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
        <MapIco name="grid" />
        {t('tables.filter.all')}
      </button>
      <button type="button" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
        <MapIco name="user" />
        {t('tables.filter.mine')}
        {mineCount > 0 && <> <span className="n num">{mineCount}</span></>}
      </button>
    </div>
  );

  const queueOf = (tile: MapTile) => shell.enqueue.pendingFor(tile.table_id) > 0;
  const zones =
    map === null ? (
      <Skeleton />
    ) : allTiles.length === 0 && floors.length === 0 ? (
      <div className="empty">
        <b>{t('tables.empty')}</b>
        <span>{t('tables.empty_sub')}</span>
      </div>
    ) : sections.length === 0 ? (
      <div className="empty">
        <b>{filter === 'mine' ? t('tables.mine_empty') : t('tables.empty_floor')}</b>
      </div>
    ) : (
      sections.map((section) => (
        <Zone key={section.key} section={section} assignee={section.kind === 'zone' ? zoneAssignee(section.tiles) : null} staffId={staffId}>
          {section.tiles.map((tile) => (
            <Tile
              key={tile.table_id}
              tile={tile}
              staffId={staffId}
              nowMs={nowMs}
              late={late.get(tile.table_id)}
              zoneAssignee={section.kind === 'zone' ? zoneAssignee(section.tiles) : null}
              waiting={queueOf(tile)}
              callSentAt={shell.localFlags.callSentAt(tile.table_id)}
              onTap={openTile}
            />
          ))}
        </Zone>
      ))
    );

  const dock = canOrder && (
    <>
      <div className="duo">
        <button type="button" className="btn" onClick={() => navigate('/orders')}>
          <MapIco name="bag" />
          {t('orders.open')}
        </button>
        <button type="button" className="btn" onClick={() => navigate('/held')}>
          <MapIco name="pause" />
          {t('tables.held')}
        </button>
      </div>
      {onNewOrder !== undefined && (
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onNewOrder}>
          <MapIco name="plus" />
          {t('order.new')}
        </button>
      )}
    </>
  );

  if (shell.phone) {
    return (
      <>
        <div className="ph-body">
          <div className="chipsx">
            {floors.map((f) => (
              <button key={f.floor_id} type="button" className="chip" aria-pressed={f.floor_id === phoneFloor} onClick={() => navigate(floorHref(f.floor_id))}>
                {f.name ?? ''} <small>{f.zones.reduce((n, z) => n + z.tables.length, 0)}</small>
              </button>
            ))}
          </div>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={filter === 'mine'} onClick={() => setFilter(filter === 'mine' ? 'all' : 'mine')}>
              <MapIco name="user" />
              {t('tables.filter.mine')} {mineCount > 0 && <small>{mineCount}</small>}
            </button>
            {canOrder && (
              <button type="button" className="chip" onClick={() => navigate('/orders')}>
                <MapIco name="bag" />
                {t('orders.open')}
              </button>
            )}
          </div>
          <div className={`zones${shell.online ? '' : ' stale'}`}>{zones}</div>
        </div>
        {canOrder && onNewOrder !== undefined && (
          <div className="phbar">
            <button type="button" className="btn btn--primary btn--lg" onClick={onNewOrder}>
              <MapIco name="plus" />
              {t('order.new')}
            </button>
          </div>
        )}
      </>
    );
  }

  const needs = <NeedsYou items={items} counts={stateCounts(allTiles)} onOpen={openItem} />;
  if (shell.portrait) {
    return (
      <main className="map" aria-busy={map === null}>
        <div className="col">
          <div className="on-light">{filterButtons}</div>
          {needs}
        </div>
        <div className={`zones${shell.online ? '' : ' stale'}`}>{zones}</div>
        {canOrder && <div className="pdock">{dock}</div>}
      </main>
    );
  }
  return (
    <main className="map" aria-busy={map === null}>
      <div className={`zones${shell.online ? '' : ' stale'}`}>{zones}</div>
      <aside className="side2">
        <div className="on-light">{filterButtons}</div>
        {needs}
        {dock}
      </aside>
    </main>
  );
}

/** 02-S03 Loading: skeleton tiles until the first catch-up. */
function Skeleton() {
  return (
    <section className="zone" aria-label={t('tables.loading')}>
      <div className="zone__h">
        <span className="sk" />
      </div>
      <div className="tiles" dir="ltr">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="tt" aria-hidden="true">
            <span className="sk" />
            <span className="sk" />
            <span className="sk" />
          </div>
        ))}
      </div>
    </section>
  );
}
