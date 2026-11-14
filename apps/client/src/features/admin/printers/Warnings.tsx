import { Banner } from '../../../components/Banner';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { PrintConfig, PrintConfigWarning } from './api';

// 03c §3.2, §6.6; 03c-B01 (frame PrintersPaperOut): the print-config warnings at the top of the page. Q-48: a
// `lossy_name` warning carries the lossy `name` (HK6); before HK6 the item / option / deal id stands in (a station
// warning is named from station_outputs). A skipped ticket (fold_skipped) is danger, the rest warn.

const KEY: Record<PrintConfigWarning['kind'], MessageKey> = {
  lossy_name: 'printers.warn.lossy_name',
  fold_skipped: 'printers.warn.fold_skipped',
  suspect_waiting: 'printers.warn.suspect_waiting',
  screen_unused: 'printers.warn.screen_unused',
  no_screen: 'printers.warn.no_screen',
};

export function warningText(config: PrintConfig, w: PrintConfigWarning): string {
  const station =
    w.station_id === null || w.station_id === undefined
      ? t('print_queue.kind.document')
      : (config.station_outputs.find((o) => o.station_id === w.station_id)?.name ?? w.station_id);
  if (w.kind === 'lossy_name') {
    // an item warning names the item (station_id = its home station); a station-name warning names the station
    const name = w.name ?? w.item_id ?? station;
    return fill(t(KEY.lossy_name), { name });
  }
  return fill(t(KEY[w.kind]), { station });
}

export function Warnings({ config }: { config: PrintConfig }) {
  if (config.warnings.length === 0) return null;
  const sorted = [...config.warnings].sort((a, b) => Number(b.kind === 'fold_skipped') - Number(a.kind === 'fold_skipped'));
  return (
    <div className="pos-banners">
      {sorted.map((w, i) => (
        <Banner key={`${w.kind}-${w.station_id ?? ''}-${w.item_id ?? ''}-${i}`} tone={w.kind === 'fold_skipped' ? 'danger' : 'warn'} text={warningText(config, w)} />
      ))}
    </div>
  );
}
