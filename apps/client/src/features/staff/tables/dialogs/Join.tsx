import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { MapTile, SeatingRef, TableMapBody } from '../contracts';
import { STATE_WORD, stateKey } from '../sheet/actions';
import { MiniTile, freeTilesByFloor } from './Move';
import { DialogFrame } from './TableBusy';

// 02a §3.11, §6.10 (02-D10 Join): `MergeTables { into_table_id, into_seating_id, table_id, table_seating_id }` —
// a FREE table joins this party (`table_seating_id: null`), or another party is absorbed (its seating as shown on
// its tile; T18). Parties: one tile per other open seating, never one waiting for cleaning (409 on the hub).

/** One tile per other open seating (its primary table's tile when listed), in map order. */
export function otherParties(body: TableMapBody | null, own_seating_id: string): MapTile[] {
  const seen = new Map<string, MapTile>();
  for (const x of (body?.floors ?? []).flatMap((f) => f.zones.flatMap((z) => z.tables))) {
    if (x.seating_id === null || x.seating_id === own_seating_id || x.state === 'NEEDS_CLEANING') continue;
    const had = seen.get(x.seating_id);
    if (had === undefined || (had.table_id !== had.primary_table_id && x.table_id === x.primary_table_id)) seen.set(x.seating_id, x);
  }
  return [...seen.values()];
}

export const tileCode = (x: MapTile): string => (x.joined_table_names.length > 1 ? x.joined_table_names.join(' + ') : x.name);

const ordersText = (n: number) => (n === 1 ? t('join.order_one') : fill(t('join.orders_n'), { n: String(n) }));

export interface JoinProps {
  code: string;
  seating: SeatingRef;
  body: TableMapBody | null;
  onClose(): void;
  onJoined(): void;
  onFailed(error: HubError): void;
}

export function Join({ code, seating, body, onClose, onJoined, onFailed }: JoinProps) {
  const { tables, me } = useShell();
  const [picked, setPicked] = useState<MapTile | null>(null);
  const [busy, setBusy] = useState(false);
  /** one send at a time (a ref: two taps before the re-render cannot both send) */
  const inflight = useRef(false);
  const free = freeTilesByFloor(body).flatMap((g) => g.tiles);
  const parties = otherParties(body, seating.seating_id);

  async function join(): Promise<void> {
    if (picked === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const answer = await tables.mergeTables({
      into_table_id: seating.table_id,
      into_seating_id: seating.seating_id,
      table_id: picked.table_id,
      table_seating_id: picked.seating_id,
    });
    inflight.current = false;
    setBusy(false);
    if (answer.ok) onJoined();
    else onFailed(answer.error);
  }

  return (
    <DialogFrame code={code} title={fill(t('join.title'), { table: code })} wide onClose={onClose}>
      {free.length > 0 && (
        <>
          <div className="grp__h">{t('join.free')}</div>
          <div className="mts">
            {free.map((x) => (
              <MiniTile key={x.table_id} tile={x} me={me?.staff_id ?? null} pressed={picked?.table_id === x.table_id} onPick={() => setPicked(x)} />
            ))}
          </div>
        </>
      )}
      {parties.length > 0 && (
        <>
          <div className="grp__h">{t('join.parties')}</div>
          <div className="mts">
            {parties.map((x) => {
              const who = x.holder === null ? null : x.holder.staff_id === me?.staff_id ? t('join.yours') : (x.holder.name ?? '');
              const bits = [who, t(stateKey(x.state)), x.live_order_count > 0 ? ordersText(x.live_order_count) : null].filter((b): b is string => b !== null && b !== '');
              return (
                <button key={x.table_id} type="button" className={`mt party c-${STATE_WORD[x.state]}`} aria-pressed={picked?.table_id === x.table_id} onClick={() => setPicked(x)}>
                  <b dir="ltr">{tileCode(x)}</b>
                  <small>{bits.join(' · ')}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
      {picked !== null && picked.seating_id !== null && (
        <div className="sumline">{fill(t('join.summary_absorb'), { table: tileCode(picked), n: String(picked.live_order_count), into: code })}</div>
      )}
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={picked === null || busy} onClick={() => void join()}>
          {t('join.go')}
        </button>
      </div>
    </DialogFrame>
  );
}
