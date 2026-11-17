import { useCallback, useEffect, useRef, useState } from 'react';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { errorKey, fill } from '../../../../i18n/en';
import type { HubResult } from '../../../../api/hub-admin';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { OrdersCatchUp, ZoneStockBody } from '../contracts';
import { useLiveRefetch } from '../lists/OpenOrders';
import { CountSheet } from './CountSheet';
import { RefillSheet } from './RefillSheet';

// 02b v1.0.11 §8 Zone stock screen, §3.10, §6.9, §6.10, §6.17 (inventory 02b-S12; frames ZoneStock, ZoneRefill),
// #/zones: every zone in floor order, a count per item, Low / Empty with icon + word, Refill (+n) = AddZoneStock and
// Count (= n) = SetZoneStock. Both need `manage-zone-stock` (a my_zones scope is the hub's call: 403 outside_scope).
// Counts are read again on ZoneStockSet / ZoneStockAdded frames (never added up here: a Refill is also in the answer);
// so order frames and a catch-up / reconnect read the counts again (debounced, no timer).

type Pick = { kind: 'refill' | 'count'; zone_id: string; item_id: string };

const ZONE_FRAMES: ReadonlySet<string> = new Set(['ZoneStockSet', 'ZoneStockAdded', 'ItemAdded', 'ItemRemoved', 'OrderCancelled']);


function seed(part: unknown): ZoneStockBody[] | null {
  const z = (part as Partial<OrdersCatchUp> | undefined)?.zone_stock;
  return Array.isArray(z) ? z : null;
}

export function ZoneStock() {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [zones, setZones] = useState<ZoneStockBody[] | null>(() => seed(shell.live.part('orders')));
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const can = shell.permissions.allowed('manage-zone-stock');

  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    const answer = await shellRef.current.orders.zoneStock();
    if (mine !== request.current) return;
    if (!answer.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setZones(answer.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load(), ZONE_FRAMES);

  // ZoneStockSet / ZoneStockAdded: the count is read again, never added up here — the hub's answer to our own Refill
  // and its frame both carry the same amount, and either may come first. A read already in flight is out of date.
  useEffect(
    () =>
      shell.live.subscribe((m) => {
        if (m.kind === 'event' && (m.event.event_type === 'ZoneStockSet' || m.event.event_type === 'ZoneStockAdded')) request.current += 1;
      }),
    [shell.live],
  );

  const picked = pick === null ? undefined : zones?.find((z) => z.zone_id === pick.zone_id);
  const pickedItem = picked?.items.find((i) => i.item_id === pick?.item_id);

  /**
   * The hub's refusals as toasts. Returns whether the sheet stays open: for STOCK_INSUFFICIENT (lower the number) and
   * for a lost reply (try again; the retry carries the same command_id).
   */
  const refused = (e: Extract<HubResult<unknown>, { ok: false }>['error']): boolean => {
    const toasts = shellRef.current.toasts;
    if (e.kind === 'network') {
      // not queueable (§3.12): offline it needs the hub
      toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
      return true;
    }
    if (e.kind !== 'api') {
      toasts.show({ text: t('errors.UNKNOWN'), tone: 'warn' });
      return false;
    }
    if (e.code === 'PERMISSION_DENIED') toasts.show({ text: t('zone.err.my_zones'), tone: 'warn' });
    else if (e.code === 'STOCK_INSUFFICIENT') {
      const available = e.details['available'];
      toasts.show({ text: typeof available === 'number' ? fill(t('zone.err.stock'), { n: String(available) }) : t(errorKey(e.code)), tone: 'warn' });
      return true;
    } else if (e.code === 'BUSINESS_DAY_NOT_OPEN') toasts.show({ text: t('zone.err.day'), tone: 'warn' });
    else toasts.show({ text: t(errorKey(e.code)), tone: 'warn' });
    return false;
  };

  // A retry after a lost reply sends the same command_id (the hub replays its stored answer: the store is never
  // drawn twice). A different amount, or leaving the sheet, is a new command.
  const attempt = useRef<{ sig: string; id: string } | null>(null);
  const run = async (p: Pick, type: 'AddZoneStock' | 'SetZoneStock', amount: number, done: (n: number) => string) => {
    if (busy) return;
    const sig = `${type}|${p.zone_id}|${p.item_id}|${amount}`;
    const id = attempt.current?.sig === sig ? attempt.current.id : newUlid();
    attempt.current = { sig, id };
    const payload = type === 'AddZoneStock' ? { zone_id: p.zone_id, item_id: p.item_id, quantity: amount } : { zone_id: p.zone_id, item_id: p.item_id, on_hand: amount };
    setBusy(true);
    const answer = await shellRef.current.api.command<{ on_hand: number }>(type, payload, { commandId: id });
    setBusy(false);
    if (answer.ok) {
      attempt.current = null;
      // the count is read, not computed: the answer and the ZoneStock frame both include this amount
      void load();
      shellRef.current.toasts.show({ text: done(answer.data.on_hand) });
      setPick(null);
      return;
    }
    const keep = refused(answer.error);
    // only a lost reply keeps its command_id; a refusal (the hub did not do it) is a new command next time
    if (answer.error.kind !== 'network') attempt.current = null;
    if (!keep) setPick(null);
  };
  const close = () => {
    attempt.current = null;
    setPick(null);
  };

  const sheet = shell.phone || shell.portrait;
  const body = (
    <section className="lcard">
      <div className="lcard__h">
        <h2>{t('zone.title')}</h2>
        <span className="end muted">{shell.online ? t('zone.live') : ''}</span>
      </div>
      <div className="lcard__b">
        {zones === null && !failed && <p className="muted">{t('common.loading')}</p>}
        {failed && zones === null && (
          <div className="msg c-danger" role="alert">
            <Ico name="warn" />
            <span>{t('zone.load_failed')}</span>
            <button type="button" className="btn" onClick={() => void load()}>
              {t('orders.retry')}
            </button>
          </div>
        )}
        {zones !== null && zones.length === 0 && <p className="muted">{t('zone.empty_list')}</p>}
        {zones?.map((z) => (
          <div key={z.zone_id} className="col" role="group" aria-label={z.name}>
            <div className="grp__h">{z.name}</div>
            {z.items.map((i) => {
              const out = i.on_hand <= 0;
              const low = !out && i.on_hand <= i.threshold;
              const name = i.name ?? i.item_id;
              return (
                <div key={i.item_id} className={`zs${low ? ' low' : ''}${out ? ' out' : ''}`}>
                  <span>
                    <b>{name}</b>
                    <small>{fill(t('zone.warn_at'), { n: String(i.threshold) })}</small>
                  </span>
                  <span className="n num">{i.on_hand}</span>
                  {out ? (
                    <span className="stg c-danger">
                      <Ico name="warn" />
                      {t('zone.empty')}
                    </span>
                  ) : low ? (
                    <span className="stg c-warn">
                      <Ico name="warn" />
                      {t('zone.low')}
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="row">
                    {can && (
                      <>
                        <button type="button" className="btn" onClick={() => setPick({ kind: 'refill', zone_id: z.zone_id, item_id: i.item_id })}>
                          <Ico name="tray" />
                          {t('zone.refill')}
                        </button>
                        <button type="button" className="btn" onClick={() => setPick({ kind: 'count', zone_id: z.zone_id, item_id: i.item_id })}>
                          <Ico name="check" />
                          {t('zone.count')}
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
      {shell.phone ? <div className="ph-body">{body}</div> : <main className="map map--one">{body}</main>}
      {pick !== null && picked !== undefined && pickedItem !== undefined && can && pick.kind === 'refill' && (
        <RefillSheet
          zone={picked.name}
          item={pickedItem.name ?? pickedItem.item_id}
          now={pickedItem.on_hand}
          sheet={sheet}
          busy={busy}
          onCancel={close}
          onConfirm={(quantity) =>
            void run(pick, 'AddZoneStock', quantity, (n) => fill(t('order.toast.refilled'), { n: String(n) }))
          }
        />
      )}
      {pick !== null && picked !== undefined && pickedItem !== undefined && can && pick.kind === 'count' && (
        <CountSheet
          zone={picked.name}
          item={pickedItem.name ?? pickedItem.item_id}
          now={pickedItem.on_hand}
          sheet={sheet}
          busy={busy}
          onCancel={close}
          onConfirm={(on_hand) =>
            void run(pick, 'SetZoneStock', on_hand, (n) => fill(t('zone.counted'), { n: String(n) }))
          }
        />
      )}
    </>
  );
}
