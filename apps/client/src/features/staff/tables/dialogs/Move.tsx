import { Fragment, useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { MapFloor, MapTile, SeatingRef, TableMapBody } from '../contracts';
import { MOVE_REASONS, encodeReason, reasonLabel, type ReasonToken } from '../sheet/reasons';
import { DialogFrame } from './TableBusy';

// 02a §3.10, §6.9 (02-D09 Move): a one-table party moves to a FREE, non-archived table — mini tiles by floor. A
// tile assigned to someone else carries the "Sara's" tag (a hand-over will be needed, R23). Reason optional,
// sent as its token (Q-18). `403 other_owner` → MoveOtherOwner (the sheet).

/** FREE, non-archived tiles of the configured floors, by floor (an archived table is only shown while seated). */
export function freeTilesByFloor(body: TableMapBody | null): Array<{ floor: MapFloor; tiles: MapTile[] }> {
  return (body?.floors ?? [])
    .filter((f) => !f.archived)
    .map((floor) => ({ floor, tiles: floor.zones.flatMap((z) => z.tables).filter((x) => x.seating_id === null && x.state === 'FREE' && !x.archived) }))
    .filter((g) => g.tiles.length > 0);
}

/** A free mini tile: name, seats, the owner tag when its assignee is someone else. */
export function MiniTile({ tile, me, pressed, onPick }: { tile: MapTile; me: string | null; pressed: boolean; onPick(): void }) {
  const owner = tile.assignee !== null && tile.assignee.staff_id !== me ? tile.assignee.name : null;
  return (
    <button type="button" className="mt" aria-pressed={pressed} onClick={onPick}>
      <b dir="ltr">{tile.name}</b>
      {tile.seats !== null && <small className="num">{tile.seats}</small>}
      {owner !== null && <span className="own">{fill(t('move.tag_owner'), { name: owner ?? '' })}</span>}
    </button>
  );
}

export interface MoveProps {
  code: string;
  seating: SeatingRef;
  body: TableMapBody | null;
  onClose(): void;
  onMoved(to: MapTile): void;
  onFailed(error: HubError, to: MapTile): void;
}

export function Move({ code, seating, body, onClose, onMoved, onFailed }: MoveProps) {
  const { tables, me } = useShell();
  const [to, setTo] = useState<MapTile | null>(null);
  const [token, setToken] = useState<ReasonToken | null>(null);
  const [busy, setBusy] = useState(false);
  /** one send at a time (a ref: two taps before the re-render cannot both send) */
  const inflight = useRef(false);

  async function move(): Promise<void> {
    if (to === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const payload = { from_table_id: seating.table_id, seating_id: seating.seating_id, to_table_id: to.table_id, ...(token === null ? {} : { reason: encodeReason(token, '') }) };
    const answer = await tables.moveTable(payload);
    inflight.current = false;
    setBusy(false);
    if (answer.ok) onMoved(to);
    else onFailed(answer.error, to);
  }

  return (
    <DialogFrame code={code} title={fill(t('move.title'), { table: code })} sub={t('move.sub')} wide onClose={onClose}>
      {freeTilesByFloor(body).map(({ floor, tiles }) => (
        <Fragment key={floor.floor_id}>
          <div className="grp__h">{floor.name}</div>
          <div className="mts">
            {tiles.map((x) => (
              <MiniTile key={x.table_id} tile={x} me={me?.staff_id ?? null} pressed={to?.table_id === x.table_id} onPick={() => setTo(x)} />
            ))}
          </div>
        </Fragment>
      ))}
      <div className="fld" role="group" aria-label={t('release.reason')}>
        <span className="fld__l">
          {t('release.reason')}
          <small>{t('move.optional')}</small>
        </span>
        <div className="chips">
          {MOVE_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={token === r} onClick={() => setToken(token === r ? null : r)}>
              {reasonLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={to === null || busy} onClick={() => void move()}>
          {to === null ? fill(t('move.to'), { table: '…' }) : fill(t('move.to'), { table: to.name })}
        </button>
      </div>
    </DialogFrame>
  );
}
