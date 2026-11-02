import { useEffect, useState } from 'react';
import type { AlertReceiptsResponse } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { titleText } from './labels';
import { FamilyPill, Ico, Ring, Tag } from './ui';

// 01d §6.10 S04 (frames Receipts, ReceiptsSteps, ReceiptsNone; needs manage-devices): a header with the kind and
// an Updating chip while live, then one table per step with Person · Device / route · Delivered · Seen · Note.
// An alert-connection receipt names the bound person ("Tablet 3, bound to Ali (not signed in)", §6.10).
// Re-fetched every 5 s while open (brief S04). Routes are shown as the hub lists them (AD M2).

export type ReceiptsData = ReturnType<(typeof AlertReceiptsResponse)['parse']>['data'];
type Step = ReceiptsData['steps'][number];
type Receipt = ReceiptsData['receipts'][number];
type Recipient = Step['recipients'][number];

export const RECEIPTS_POLL_MS = 5_000;

/** "2:10:03 PM" in the hub zone (AD-167 with seconds, as the frames). */
function secondsText(ms: number, utcOffsetMs: number): string {
  const d = new Date(ms + utcOffsetMs);
  const h = d.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Step names: 0 Sent, 1 Reminder, 2+ Escalated (the receipts carry no escalation flag; proposed AD). */
function stepName(step: number): string {
  return t(step === 0 ? 'receipts.step.sent' : step === 1 ? 'receipts.step.reminder' : 'receipts.step.escalated');
}

function routeText(route: string, device: string, bound: string | null): string {
  if (route === 'screen') return fill(t('receipts.route.screen'), { device });
  if (route === 'alert_connection') return bound === null ? fill(t('receipts.route.device'), { device }) : fill(t('receipts.route.bound'), { device, name: bound });
  return fill(t('receipts.route.other'), { route, ref: device });
}

interface Line {
  key: string;
  person: string;
  forName: string | null;
  route: string | null;
  delivered: number | null;
  seen: number | null;
  noRoute: boolean;
}

/** One line per recipient and device it was delivered to (a recipient with no delivery keeps one line). */
function linesOf(step: Step, receipts: readonly Receipt[]): Line[] {
  const deviceName = new Map<string, string>();
  for (const r of receipts) if (r.device_name !== null) deviceName.set(r.device_id, r.device_name);
  for (const r of step.recipients) if (r.device_id !== null && r.device_name !== null) deviceName.set(r.device_id, r.device_name);
  const seenAt = (staffId: string | null, deviceId: string) =>
    receipts.find((r) => r.kind === 'seen' && r.device_id === deviceId && (r.staff_id ?? null) === staffId)?.at ?? null;
  const lines: Line[] = [];
  step.recipients.forEach((rc: Recipient, i) => {
    const person = rc.staff_name ?? rc.device_name ?? '—';
    const mine = receipts.filter(
      (r) => r.kind === 'delivered' && r.step === step.step && (rc.staff_id !== null ? r.staff_id === rc.staff_id : r.device_id === rc.device_id),
    );
    if (mine.length > 0) {
      for (const r of mine) {
        lines.push({
          key: `${i}:${r.device_id}`,
          person,
          forName: rc.for_staff_name,
          route: routeText(r.route, r.device_name ?? r.device_id, r.staff_name),
          delivered: r.at,
          seen: seenAt(rc.staff_id, r.device_id),
          noRoute: false,
        });
      }
      return;
    }
    // nothing delivered yet: the routes the hub listed for this person (AD M2: shown as listed)
    const listed = step.routes.filter((x) => (rc.staff_id !== null ? x.staff_id === rc.staff_id : x.staff_id === null && x.ref === rc.device_id));
    lines.push({
      key: `${i}:-`,
      person,
      forName: rc.for_staff_name,
      route: listed.length === 0 ? (rc.device_name === null ? null : fill(t('receipts.route.device'), { device: rc.device_name })) : listed.map((x) => routeText(x.route, deviceName.get(x.ref) ?? x.ref, null)).join(', '),
      delivered: null,
      seen: null,
      noRoute: rc.no_route,
    });
  });
  return lines;
}

/** The kind's lock label without its parameters ("Test alert"); "Alert" for a kind with no label. */
function kindTitle(kind: string): string {
  return titleText({ kind, family: 'info', lock: { kind_label_key: `alert.${kind}.lock` } });
}

export function Receipts({
  alertId,
  load,
  summary,
  utcOffsetMs,
}: {
  alertId: string;
  load: (alertId: string) => Promise<HubResult<ReceiptsData>>;
  /** "Sent 2:10 PM by Imran · to Bilal’s team", when this device sent it */
  summary: string | null;
  utcOffsetMs: number;
}) {
  const [data, setData] = useState<ReceiptsData | null>(null);
  const [live, setLive] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setData(null);
    setMissing(false);
    const tick = async () => {
      const answer = await load(alertId);
      if (stopped) return;
      if (answer.ok) {
        setData(answer.data);
        setLive(true);
      } else {
        setLive(false);
        if (answer.error.kind === 'api' && answer.error.code === 'ALERT_NOT_FOUND') {
          setMissing(true);
          return;
        }
      }
      timer = setTimeout(() => void tick(), RECEIPTS_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [alertId, load]);

  const reached = data !== null && data.receipts.length > 0;
  const anyRoute = data !== null && data.steps.some((s) => s.recipients.some((r) => !r.no_route));

  return (
    <main className="body">
      <section className="lcard rc">
        <div className="row rc__head">
          <span className="ar__ic c-mute">
            <Ico name="pulse" />
          </span>
          <div className="grow">
            <div className="ac__top">
              {data?.kind === 'test_alert' && <FamilyPill row={{ kind: 'test_alert', family: 'info' }} />}
              <b className="rc__title">{data === null ? '' : kindTitle(data.kind)}</b>
            </div>
            {summary !== null && <p className="muted rc__sub">{summary}</p>}
          </div>
          {live && !missing && (
            <Tag tone="ok" icon="sync">
              {t('receipts.updating')}
            </Tag>
          )}
        </div>
        {missing ? (
          <div className="empty">
            <b>{t('receipts.not_found')}</b>
          </div>
        ) : data === null ? (
          <div className="rt" aria-busy="true">
            <span className="sk sk--row" />
            <span className="sk sk--row" />
          </div>
        ) : !reached && !anyRoute ? (
          <div className="empty">
            <Ring size={96} pct={100} tone="warn">
              <Ico name="warn" className="ico--36 ico--warn" />
            </Ring>
            <b>{t('receipts.nobody')}</b>
          </div>
        ) : (
          <div className="rc__steps">
            {data.steps.map((step) => {
              const lines = linesOf(step, data.receipts);
              return (
                <div key={step.step} className="col rc__step">
                  <div className="steph">
                    <Ico name={step.step === 0 ? 'send' : step.step === 1 ? 'repeat' : 'esc'} />
                    {stepName(step.step)}
                    <small>{fill(t('receipts.people'), { n: String(step.recipients.length) })}</small>
                  </div>
                  <div className="rt">
                    <div className="rt__r th">
                      <span>{t('receipts.person')}</span>
                      <span>{t('receipts.route')}</span>
                      <span>{t('receipts.delivered')}</span>
                      <span>{t('receipts.seen')}</span>
                      <span>{t('receipts.note')}</span>
                    </div>
                    {lines.map((l) => (
                      <div key={l.key} className="rt__r">
                        <b>
                          {l.person}
                          {l.forName !== null && <small className="rt__for"> {fill(t('receipts.for'), { name: l.forName })}</small>}
                        </b>
                        <span className={l.route === null ? 'none' : ''}>{l.route ?? '—'}</span>
                        <span className={`num${l.delivered === null ? ' none' : ''}`}>{l.delivered === null ? '—' : secondsText(l.delivered, utcOffsetMs)}</span>
                        <span className={`num${l.seen === null ? ' none' : ''}`}>{l.seen === null ? '—' : secondsText(l.seen, utcOffsetMs)}</span>
                        <span>
                          {l.noRoute && (
                            <Tag tone="warn" icon="warn">
                              {t('receipts.no_route')}
                            </Tag>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
