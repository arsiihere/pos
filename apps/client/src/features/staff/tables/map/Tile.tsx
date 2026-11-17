import type { TableState } from '@pos/domain';
import type { ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { initial } from '../../../alerts/ui';
import type { MapPerson, MapTile } from '../contracts';
import { minutesOpen, tileName } from './filters';

// 02a-C01 Table tile (Tiles, TilesUrdu): icon + word + colour per state, "F4 + F5" for a joined party, holder
// initials (maroon = me), a hollow assignee avatar only when the holder is someone else, one footer item (a flag, or
// padlock + name), time open, seats on a free tile. The grid is always LTR (pulse-02.css `.tiles`).

const PATHS: Record<string, ReactNode> = {
  free: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7" />
      <path d="M8.5 12h7" />
    </>
  ),
  seated: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20.5a7 7 0 0 1 14 0" />
    </>
  ),
  ordered: (
    <>
      <path d="M4 6.5h16v3.5a2 2 0 0 0 0 4v3.5H4V14a2 2 0 0 0 0-4z" />
      <path d="M14.5 7v2" />
      <path d="M14.5 11v2" />
      <path d="M14.5 15v2" />
    </>
  ),
  eating: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  bill: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h3" />
    </>
  ),
  clean: (
    <>
      <path d="M15 3l-3.5 8" />
      <path d="M7 12h9l1.5 8.5h-12z" />
      <path d="M9.5 16v4.5" />
      <path d="M13 16v4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  seats: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14a6 6 0 0 1 3 6" />
    </>
  ),
  send: (
    <>
      <path d="M3 12l18-8-7 17-3-7z" />
    </>
  ),
  call: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v3H4z" />
      <path d="M5.5 10v9h13v-9" />
      <path d="M10 14h4" />
    </>
  ),
  chev: <path d="M9 5l7 7-7 7" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1.2 12.5H6.2z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  pause: (
    <>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
};

export type MapIconName = keyof typeof PATHS;

export function MapIco({ name }: { name: MapIconName }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export const STATE_CLASS: Record<TableState, 'free' | 'seated' | 'ordered' | 'eating' | 'bill' | 'clean'> = {
  FREE: 'free',
  SEATED: 'seated',
  ORDERED: 'ordered',
  FOOD_ON_TABLE: 'eating',
  BILL_REQUESTED: 'bill',
  NEEDS_CLEANING: 'clean',
};

export const STATE_WORD = {
  FREE: 'tables.state.free',
  SEATED: 'tables.state.seated',
  ORDERED: 'tables.state.ordered',
  FOOD_ON_TABLE: 'tables.state.eating',
  BILL_REQUESTED: 'tables.state.bill',
  NEEDS_CLEANING: 'tables.state.clean',
} as const satisfies Record<TableState, string>;

const RING = 44;
const R = 20;
const STROKE = 4;

/** The puck's ring: fills over 60 min open. Drawn with SVG attributes only (no style prop, S35 d). */
function Ring({ percent, tone, state }: { percent: number | null; tone: string; state: TableState }) {
  return (
    <svg className={`ring c-${tone}`} width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
      {state !== 'FREE' && <circle cx="22" cy="22" r={R} fill="none" stroke="var(--ring-track)" strokeWidth={STROKE} />}
      {percent !== null && percent > 0 && (
        <circle cx="22" cy="22" r={R} fill="none" stroke="var(--c)" strokeWidth={STROKE} strokeLinecap="round" pathLength={100} strokeDasharray={`${percent} 100`} transform="rotate(-90 22 22)" />
      )}
      <g transform="translate(12.5 12.5) scale(0.792)" fill="none" stroke="currentColor" strokeWidth={2.9} strokeLinecap="round" strokeLinejoin="round">
        {PATHS[STATE_CLASS[state]]}
      </g>
    </svg>
  );
}

export interface TileProps {
  tile: MapTile;
  /** the signed-in person */
  staffId: string | null;
  /** hub clock */
  nowMs: number;
  /** late (Q-17): minutes late, or null when the slip row carries none; undefined = not late */
  late?: number | null | undefined;
  /** 02b's queue holds a command for this table (Q-17, "Waiting to send") */
  waiting?: boolean;
  /** Q-16: when this device sent a call (hub clock ms) */
  callSentAt?: number | null | undefined;
  /** the sheet for this tile is open */
  pressed?: boolean;
  /** the zone heading's assignee (null = the heading names none); undefined = unknown: only holder ≠ assignee counts (Q-25) */
  zoneAssignee?: MapPerson | null | undefined;
  dim?: boolean;
  onTap(tile: MapTile): void;
}

const initialOf = (p: MapPerson): string => initial(p.name ?? '?');

export function Tile({ tile, staffId, nowMs, late, waiting = false, callSentAt = null, pressed = false, zoneAssignee, dim = false, onTap }: TileProps) {
  const tone = STATE_CLASS[tile.state];
  const isLate = late !== undefined;
  const urgent = tile.state === 'BILL_REQUESTED' || isLate;
  const minutes = minutesOpen(tile, nowMs);
  const percent = minutes === null ? null : Math.round((Math.min(minutes, 60) / 60) * 1000) / 10;
  const name = tileName(tile);
  const word = t(STATE_WORD[tile.state]);
  const holderMe = tile.holder !== null && tile.holder.staff_id === staffId;
  // Q-25: hollow when the assignee is not the holder, or differs from the heading's (no name there counts as differing)
  const hollow =
    tile.assignee !== null &&
    ((tile.holder !== null && tile.assignee.staff_id !== tile.holder.staff_id) ||
      (zoneAssignee !== undefined && zoneAssignee?.staff_id !== tile.assignee.staff_id && tile.assignee.staff_id !== tile.holder?.staff_id));

  const flag = isLate ? 'late' : waiting ? 'waiting' : callSentAt !== null ? 'call' : tile.archived ? 'archived' : null;
  const classes = ['tt', `s-${tone}`, `c-${tone}`, urgent ? 'urgent' : null, tile.archived ? 'arch' : null, pressed ? 'pressed' : null, dim ? 'dim' : null].filter((c) => c !== null).join(' ');

  const label = [
    name,
    word,
    tile.holder?.name ?? null,
    minutes === null ? null : `${minutes} min`,
    tile.party_size === null ? null : `${tile.party_size}`,
    tile.lock === null ? null : `${tile.lock.name ?? ''}`,
  ]
    .filter((x): x is string => x !== null && x !== '')
    .join(', ');

  return (
    <button type="button" className={classes} aria-label={label} onClick={() => onTap(tile)}>
      <span className="tt__top">
        <span className="tt__puck">
          <Ring percent={percent} tone={isLate ? 'warn' : tone} state={tile.state} />
        </span>
        <span className="tt__av">
          {hollow && tile.assignee !== null && (
            <span className="tav tav--as" title={tile.assignee.name ?? ''}>
              {initialOf(tile.assignee)}
            </span>
          )}
          {tile.holder !== null && <span className={`tav${holderMe ? ' tav--me' : ''}`}>{initialOf(tile.holder)}</span>}
        </span>
      </span>
      <span className={`tt__n${tile.joined_table_names.length > 1 ? ' j' : ''}`}>{name}</span>
      <span className="tt__s">
        {word}
        {minutes !== null && tile.state !== 'NEEDS_CLEANING' && <span className="t">{fill(t('tables.tile.min'), { n: String(minutes) })}</span>}
      </span>
      <span className="tt__f">
        {flag === 'late' && (
          <span className="fl c-warn">
            <MapIco name="clock" />
            {late === null ? t('tables.flag.late_unknown') : fill(t('tables.flag.late'), { n: String(late) })}
          </span>
        )}
        {flag === 'waiting' && (
          <span className="fl fl--q">
            <MapIco name="send" />
            {t('tables.flag.waiting_to_send')}
          </span>
        )}
        {flag === 'call' && callSentAt !== null && (
          <span className="fl c-seated">
            <MapIco name="call" />
            {fill(t('tables.flag.call_sent'), { n: String(Math.max(0, Math.floor((nowMs - callSentAt) / 60_000))) })}
          </span>
        )}
        {flag === 'archived' && (
          <span className="fl fl--q">
            <MapIco name="archive" />
            {t('tables.flag.archived')}
          </span>
        )}
        {flag === null && tile.lock !== null && (
          <span className={`lk${tile.lock.mine ? ' lk--me' : ''}`}>
            <MapIco name="lock" />
            {tile.lock.mine ? t('tables.lock.you') : fill(t('tables.lock.name'), { name: tile.lock.name ?? '' })}
          </span>
        )}
        {flag === null && tile.lock === null && tile.state === 'FREE' && tile.seats !== null && (
          <span className="tt__seats">
            <MapIco name="seats" />
            {tile.seats}
          </span>
        )}
      </span>
    </button>
  );
}
