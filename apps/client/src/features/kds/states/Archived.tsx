import { t } from '../../../i18n';

// 03b §3.3, §3.10 (K4; frame 03b-B07 KdsArchived): "Station archived — finish open tickets · 3 open" over the view;
// rows keep working. Shown while the station still has lines (from `station_notice { kind: 'archived' }`).
export function Archived({ open }: { open: number }) {
  const [text, rest = ''] = t('kds.archived').split(' · ');
  const [before, after = ''] = rest.split('{n}');
  return (
    <div className="kbn c-warn" role="status">
      {text}
      <small>
        {before}
        <b className="num">{open}</b>
        {after}
      </small>
    </div>
  );
}
