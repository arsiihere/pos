import { t } from '../../../i18n';

// 02a §8 Top bar (frame 02a-C10): the floor segmented control with table counts. The floor list comes from
// `TableMapBody.floors`; the choice lives in the hash query `#/tables?floor=<floor_id>` (absent = all floors), written
// by this control (`floorHref` of map/filters.ts) and read by the map (`floorOf`). Names are isolated per name: a Latin name stays LTR in an Urdu
// page, an Urdu name reads RTL; counts are Latin digits.

export interface FloorChoice {
  floor_id: string;
  name: string;
  count: number;
}

function nameDir(name: string): 'ltr' | 'rtl' {
  return /[؀-ۿ]/.test(name) ? 'rtl' : 'ltr';
}

export function FloorControl({
  floors,
  selected,
  onSelect,
  fill = false,
}: {
  floors: readonly FloorChoice[];
  selected: string | null;
  onSelect: (floor_id: string) => void;
  /** portrait: full-width row */
  fill?: boolean;
}) {
  if (floors.length === 0) return null;
  return (
    <div className={`seg${fill ? ' seg--fill' : ''}`} role="group" aria-label={t('topbar.floor')}>
      {floors.map((f) => (
        <button key={f.floor_id} type="button" aria-pressed={selected === f.floor_id} onClick={() => onSelect(f.floor_id)}>
          <bdi dir={nameDir(f.name)}>{f.name}</bdi>
          <span className="n num">{f.count}</span>
        </button>
      ))}
    </div>
  );
}
