import type { TableState } from '@pos/domain';
import { t } from '../../../../i18n';
import { STATE_CLASS, STATE_WORD, MapIco } from './Tile';

// 02-S03 legend: six states, icon + word + count (`.lgd`).

const ORDER: TableState[] = ['FREE', 'SEATED', 'ORDERED', 'FOOD_ON_TABLE', 'BILL_REQUESTED', 'NEEDS_CLEANING'];

export function Legend({ counts }: { counts: Record<TableState, number> }) {
  return (
    <div className="lgd">
      {ORDER.map((s) => (
        <span key={s} className={`c-${STATE_CLASS[s]}`}>
          <MapIco name={STATE_CLASS[s]} />
          <b className="num">{counts[s]}</b>
          {t(STATE_WORD[s])}
        </span>
      ))}
    </div>
  );
}
