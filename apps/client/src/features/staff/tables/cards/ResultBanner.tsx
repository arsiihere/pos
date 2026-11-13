import type { ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { navigate } from '../../../../app/router';
import { Ico, Ring } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { tableHref } from '../../shell/routes';
import type { LockBannerState, MapTile, TableMapBody } from '../contracts';
import { pendingHandovers, type HandoverResult } from './pending-handovers';

// 02a §8 Table sheet / Handover waiting card, Q-14 (02a-C04 HandoverDeclined, HandoverAccepted): the sender's
// result cards, info family, newest on top. Declined → "Hand over to someone else" (the table sheet, where Hand
// over is); accepted → OK, hidden by the store after 4 s; closed by the table (obsolete) → OK. §8 Banners
// (ForceMovedToMe): "A manager gave you F2" + Open table. They render inside the one 01d banner stack
// (alerts/Banner.tsx: its phone / wide variant, at most 2 cards), never in a second stack of their own.

/** The force-move notice the map's lock listener (HandoverLayer) raised, for the banner stack. */
export type ForceMoveNotice = Extract<LockBannerState, { kind: 'force_moved_to_me' }>;

export const forceMoveNotice = (() => {
  let current: ForceMoveNotice | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): ForceMoveNotice | null => current,
    set(next: ForceMoveNotice | null) {
      if (next === current) return;
      current = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

/** The tile of a result after a reload (no table_id remembered): by the request's table_code = the tile's names. */
function tileOf(map: TableMapBody | undefined, r: HandoverResult): MapTile | null {
  const tiles = (map?.floors ?? []).flatMap((f) => f.zones.flatMap((z) => z.tables));
  if (r.table_id !== null) return tiles.find((x) => x.table_id === r.table_id) ?? null;
  return tiles.find((x) => (x.joined_table_names.length > 0 ? x.joined_table_names.join(' + ') : x.name) === r.table_code) ?? null;
}

export function ResultCard({ r }: { r: HandoverResult }) {
  const shell = useShell();
  const table = r.table_code ?? '';
  const name = r.name ?? t('lock.someone');
  const handOverAgain = () => {
    const tile = tileOf(shell.live.part('tables') as TableMapBody | undefined, r);
    pendingHandovers.dismiss(r.id);
    const table_id = r.table_id ?? tile?.table_id ?? null;
    navigate(table_id === null ? '/tables' : tableHref(table_id, r.seating_id ?? tile?.seating_id ?? null));
  };
  const tone = r.outcome === 'accepted' ? 'ok' : 'mute';
  const title =
    r.outcome === 'accepted'
      ? fill(t('handover.result.accepted'), { name, table })
      : r.outcome === 'declined'
        ? fill(t('handover.result.declined'), { name, table })
        : fill(t('handover.result.closed'), { table });
  return (
    <div className={`abn abn--info${r.outcome === 'declined' ? ' abn--stack' : ''} c-${tone}`} role="alert" data-handover={r.id}>
      <Ring size={56} pct={null} tone={tone}>
        <Ico name={r.outcome === 'accepted' ? 'check' : r.outcome === 'declined' ? 'x' : 'info'} />
      </Ring>
      <div className="ac__body">
        <div className="ac__top">
          <span className="fam fam--info">
            <Ico name="info" />
            {t('alerts.family.info')}
          </span>
        </div>
        <div className="ac__title">
          {table !== '' && (
            <span className="tcode tcode--sm" dir="ltr">
              {table}
            </span>
          )}
          <b>{title}</b>
        </div>
        {r.outcome !== 'closed' && <div className="ac__det">{r.outcome === 'accepted' ? fill(t('handover.result.theirs'), { name }) : t('handover.result.stays_yours')}</div>}
      </div>
      {r.outcome === 'declined' ? (
        <button type="button" className="btn btn--tone c-mute" onClick={handOverAgain}>
          {t('handover.result.to_someone_else')}
        </button>
      ) : (
        <button type="button" className={`btn btn--tone c-${tone}`} onClick={() => pendingHandovers.dismiss(r.id)}>
          {t('lock.ok')}
        </button>
      )}
    </div>
  );
}

export function ForceMovedCard({ state }: { state: ForceMoveNotice }) {
  const shell = useShell();
  const open = () => {
    const tiles = ((shell.live.part('tables') as TableMapBody | undefined)?.floors ?? []).flatMap((f) => f.zones.flatMap((z) => z.tables));
    const tile = tiles.find((x) => x.name === state.table) ?? null;
    forceMoveNotice.set(null);
    navigate(tile === null ? '/tables' : tableHref(tile.table_id, tile.seating_id));
  };
  return (
    <div className="abn abn--info c-info" role="alert">
      <Ring size={56} pct={null} tone="info">
        <Ico name="info" />
      </Ring>
      <div className="ac__body">
        <div className="ac__top">
          <span className="fam fam--info">
            <Ico name="info" />
            {t('alerts.family.info')}
          </span>
        </div>
        <div className="ac__title">
          {state.table !== '' && (
            <span className="tcode tcode--sm" dir="ltr">
              {state.table}
            </span>
          )}
          <b>{fill(t('forcemove.notice_receiver'), { table: state.table })}</b>
        </div>
      </div>
      <button type="button" className="btn btn--tone c-info" onClick={open}>
        {t('forcemove.open_table')}
      </button>
    </div>
  );
}

/** The handover cards for the banner stack, newest first: the force-move notice, then the results. */
export function handoverCards(): Array<{ key: string; node: ReactNode }> {
  const notice = forceMoveNotice.get();
  return [
    ...(notice === null ? [] : [{ key: 'force-move', node: <ForceMovedCard state={notice} /> }]),
    ...[...pendingHandovers.results()].reverse().map((r) => ({ key: `handover-${r.id}`, node: <ResultCard r={r} /> })),
  ];
}
