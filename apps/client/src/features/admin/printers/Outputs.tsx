import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import type { ConfigPrinter, StationOutput } from './api';
import { outputRow } from './output-modes';

// 03c §3.2, §6.6; 03c-S02 (frame Printers): where each station's tickets go. Archived rows (an archived or unknown
// station's output, Q-18) are listed under "Archived stations", read-only. The section id is the target of the
// archive dialog's "Go to Station outputs".

export const OUTPUTS_SECTION_ID = 'station-outputs';

function Row({ output, printers, onEdit }: { output: StationOutput; printers: readonly ConfigPrinter[]; onEdit?: (() => void) | undefined }) {
  const view = outputRow(output, printers);
  return (
    <div className={`pos-list__row${output.archived ? ' is-muted' : ''}`}>
      <span className="pos-list__name">
        <strong>{output.name ?? output.station_id}</strong>
        {output.archived && <span>{t('outputs.read_only')}</span>}
      </span>
      <span>{view.option}</span>
      <span>{view.printer}</span>
      <span className="pos-list__meta">{view.ticket}</span>
      {onEdit === undefined ? (
        <span />
      ) : (
        <button type="button" className="pos-btn" onClick={onEdit}>
          <Icon name="edit" />
          {t('printers.edit')}
        </button>
      )}
    </div>
  );
}

export function Outputs({
  outputs,
  printers,
  onEdit,
}: {
  outputs: readonly StationOutput[];
  printers: readonly ConfigPrinter[];
  /** absent = read-only (00 M89: no manage-devices) */
  onEdit?: ((output: StationOutput) => void) | undefined;
}) {
  const active = outputs.filter((o) => !o.archived);
  const archived = outputs.filter((o) => o.archived);
  return (
    <section className="ad-stack" id={OUTPUTS_SECTION_ID}>
      <div className="ad-sec__h">
        <div>
          <h2>{t('outputs.title')}</h2>
          <p>{t('outputs.help')}</p>
        </div>
      </div>
      <div className="pos-list pos-list--out">
        <div className="pos-list__head">
          <span>{t('outputs.col.station')}</span>
          <span>{t('outputs.col.output')}</span>
          <span>{t('outputs.col.printer')}</span>
          <span>{t('outputs.col.ticket')}</span>
          <span />
        </div>
        {active.map((o) => (
          <Row key={o.station_id} output={o} printers={printers} onEdit={onEdit === undefined ? undefined : () => onEdit(o)} />
        ))}
        {archived.length > 0 && <div className="pos-list__group">{t('outputs.archived')}</div>}
        {archived.map((o) => (
          <Row key={o.station_id} output={o} printers={printers} />
        ))}
      </div>
    </section>
  );
}
