import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { PrintConfig, PrintQueue, QueueJob } from './api';
import { printerErrorText } from './TestPrint';

// 03c §6.5, §6.7; 03c-S03 (frames Printers, PrintersPaperOut; Q-19): the pending jobs (newest 100), the per-printer
// totals (waiting, may not have printed) and the no-printer total. Q-54: Refresh is the only re-read here; the page
// also re-reads once after each own command. The time column needs the hub clock, which the admin pages do not have
// (no page meta, no `hub_time` in print-queue), so it shows "—" (the jobs stay newest first, as the hub sends them).

export const KIND_KEY: Record<QueueJob['kind'], MessageKey> = {
  kitchen: 'print_queue.kind.kitchen',
  reprint: 'print_queue.kind.reprint',
  cancel: 'print_queue.kind.cancel',
  first: 'print_queue.kind.first',
  coming_up: 'print_queue.kind.coming_up',
  document: 'print_queue.kind.document',
};

export function stationOf(config: PrintConfig | null, stationId: string | null): string | null {
  if (stationId === null) return null;
  return config?.station_outputs.find((o) => o.station_id === stationId)?.name ?? stationId;
}

/** "Grill · Ticket": the cancel dialog's line. */
export function jobWhat(config: PrintConfig | null, job: QueueJob): string {
  return [stationOf(config, job.station_id), t(KIND_KEY[job.kind])].filter((p) => p !== null).join(' · ');
}

function JobState({ job }: { job: QueueJob }) {
  if (job.no_printer) return <Chip tone="danger">{t('print_queue.no_printer')}</Chip>;
  if (job.suspect_at !== null) return <Chip tone="warn">{t('print_queue.suspect')}</Chip>;
  if (job.attempts > 0) {
    return (
      <>
        <Chip tone="warn">{fill(t('print_queue.tried'), { n: String(job.attempts) })}</Chip>
        {job.last_error !== null && <span className="pos-list__meta"> {printerErrorText(job.last_error)}</span>}
      </>
    );
  }
  return <Chip>{t(job.sent_at !== null ? 'print_queue.sending' : 'print_queue.waiting')}</Chip>;
}

export function Queue({
  queue,
  config,
  onRefresh,
  onCancel,
}: {
  queue: PrintQueue;
  config: PrintConfig | null;
  onRefresh: () => void;
  /** absent = read-only (00 M89: no manage-devices) */
  onCancel?: ((job: QueueJob) => void) | undefined;
}) {
  const printerName = (id: string | null) =>
    id === null ? t('print_queue.no_printer_short') : (queue.printers.find((p) => p.printer_id === id)?.name ?? config?.printers.find((p) => p.printer_id === id)?.name ?? id);
  const totals = queue.printers.filter((p) => p.waiting > 0 || p.suspect > 0);
  return (
    <section className="ad-stack" data-section="print-queue">
      <div className="ad-sec__h">
        <div>
          <h2>{t('print_queue.title')}</h2>
          <p>{t('print_queue.help')}</p>
        </div>
        <div className="end">
          <button type="button" className="pos-btn pos-btn--ghost" onClick={onRefresh}>
            <Icon name="reload" />
            {t('print_queue.refresh')}
          </button>
        </div>
      </div>
      {queue.no_printer > 0 && <Banner tone="danger" text={fill(t('print_queue.no_printer_total'), { n: String(queue.no_printer) })} />}
      {totals.length > 0 && (
        <div className="pos-chips">
          {totals.map((p) => (
            <Chip key={p.printer_id} tone={p.suspect > 0 ? 'warn' : undefined}>
              {fill(t('print_queue.printer_total'), { printer: p.name, waiting: String(p.waiting), suspect: String(p.suspect) })}
            </Chip>
          ))}
        </div>
      )}
      {queue.jobs.length === 0 ? (
        <div className="pos-card ad-empty">
          <p>{t('admin.pr.queue_empty')}</p>
        </div>
      ) : (
        <div className="pos-list pos-list--q">
          <div className="pos-list__head">
            <span>{t('print_queue.col.time')}</span>
            <span>{t('print_queue.col.what')}</span>
            <span>{t('print_queue.col.where')}</span>
            <span>{t('print_queue.col.state')}</span>
            <span />
          </div>
          {queue.jobs.map((job) => (
            <div className="pos-list__row" key={job.job_id}>
              <span className="qtime">—</span>
              <span>
                <strong>
                  {job.is_reprint && (
                    <>
                      <span className="tagrp">{t('print_queue.reprint_tag')}</span>{' '}
                    </>
                  )}
                  {t(KIND_KEY[job.kind])}
                </strong>
              </span>
              <span>{[stationOf(config, job.station_id), printerName(job.printer_id)].filter((p) => p !== null).join(' · ')}</span>
              <span>
                <JobState job={job} />
              </span>
              {onCancel === undefined ? (
                <span />
              ) : (
                <button type="button" className="pos-btn pos-btn--ghost" onClick={() => onCancel(job)}>
                  {t('common.cancel')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
