import { useState } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { timeText } from './labels';
import { isSilent } from './sounds';
import type { AlertRow } from './store';
import { Ico, OpenCard, Ring, RowCard, initial, isRequest } from './ui';

// 01d §8.1, §6.7 (S01, frames Inbox, InboxLead, InboxEmpty, InboxLoading, InboxOffline): two list cards, Open
// (big cards: open requests and action alerts) and Today (rows, newest first). A lead sees one "For <name>"
// group per person (DQ5), the first open; requests never go in a group. Offline: the last list stays with the
// B03 line, and details still open.

export interface InboxSections {
  open: AlertRow[];
  today: AlertRow[];
  groups: Array<{ name: string; rows: AlertRow[] }>;
}

const newestFirst = (a: AlertRow, b: AlertRow) => b.raised_at - a.raised_at || (a.alert_id < b.alert_id ? 1 : -1);

/** §6.7 order: open action alerts first, then newest first. Open requests sit with them in the Open card. */
export function inboxSections(rows: readonly AlertRow[]): InboxSections {
  const open: AlertRow[] = [];
  const today: AlertRow[] = [];
  const groups = new Map<string, AlertRow[]>();
  for (const r of rows) {
    const big = r.state === 'open' && !isSilent(r) && (r.family === 'action' || r.family === 'urgent');
    if (big) open.push(r);
    else if (r.for_staff_name !== null && !isRequest(r)) {
      const list = groups.get(r.for_staff_name) ?? [];
      list.push(r);
      groups.set(r.for_staff_name, list);
    } else today.push(r);
  }
  open.sort((a, b) => (a.family === 'action' ? 0 : 1) - (b.family === 'action' ? 0 : 1) || newestFirst(a, b));
  today.sort(newestFirst);
  return { open, today, groups: [...groups].map(([name, list]) => ({ name, rows: list.sort(newestFirst) })) };
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div className="ar" aria-hidden="true" key={i}>
          <span className="sk sk--ic" />
          <span className="col col--8">
            <span className="sk sk--l1" />
            <span className="sk sk--l2" />
          </span>
          <span className="sk sk--t" />
        </div>
      ))}
    </>
  );
}

function ForGroup({ name, rows, first, utcOffsetMs, onOpen }: { name: string; rows: AlertRow[]; first: boolean; utcOffsetMs: number; onOpen: (r: AlertRow) => void }) {
  const [open, setOpen] = useState(first);
  // "For Ali · 2 · no device": the name part bold, the rest small (frame InboxLead)
  const [label, ...rest] = fill(t('alerts.for_group'), { name, n: String(rows.length) }).split(' · ');
  return (
    <div className="forg">
      <button type="button" className="forg__h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="av av--sm">{initial(name)}</span>
        {label} <small>· {rest.join(' · ')}</small>
        <Ico name={open ? 'down' : 'chev'} />
      </button>
      {open && rows.map((r) => <RowCard key={r.alert_id} row={r} utcOffsetMs={utcOffsetMs} onOpen={() => onOpen(r)} />)}
    </div>
  );
}

export function Inbox({
  rows,
  loading,
  offlineAt,
  nowMs,
  utcOffsetMs,
  onOpen,
  hasMore = false,
  onMore,
}: {
  rows: readonly AlertRow[];
  loading: boolean;
  /** B03: when the hub socket went down (the list is from then), or null while up */
  offlineAt: number | null;
  nowMs: number;
  utcOffsetMs: number;
  onOpen: (row: AlertRow) => void;
  hasMore?: boolean;
  onMore?: () => void;
}) {
  const offline =
    offlineAt === null ? null : (
      <div className="body__full">
        <div className="msg c-danger" role="alert">
          <Ico name="wifioff" />
          <span>{fill(t('alerts.offline_since'), { time: timeText(offlineAt, utcOffsetMs) })}</span>
        </div>
      </div>
    );

  if (!loading && rows.length === 0) {
    return (
      <main className={`body${offline === null ? '' : ' body--msg'}`}>
        {offline}
        <section className="lcard">
          <div className="empty">
            <Ring size={96} pct={100} tone="ok">
              <Ico name="check" className="ico--36 ico--ok" />
            </Ring>
            <b>{t('alerts.empty')}</b>
            <span>{t('alerts.empty_sub')}</span>
          </div>
        </section>
      </main>
    );
  }

  const s = inboxSections(rows);
  const todayCount = s.today.length + s.groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <main className={`body body--two${offline === null ? '' : ' body--msg'}`}>
      {offline}
      <section className="lcard">
        <div className="lcard__h">
          <h2>{t('alerts.open')}</h2>
          {!loading && <span className="cnt num cnt--hot">{s.open.length}</span>}
          <div className="end" />
        </div>
        <div className="lcard__b">
          {loading ? <SkeletonRows /> : s.open.map((r) => <OpenCard key={r.alert_id} row={r} nowMs={nowMs} utcOffsetMs={utcOffsetMs} onOpen={() => onOpen(r)} />)}
        </div>
      </section>
      <section className="lcard">
        <div className="lcard__h">
          <h2>{t('alerts.today')}</h2>
          {!loading && <span className="cnt num">{todayCount}</span>}
          <div className="end" />
        </div>
        <div className="lcard__b">
          {loading ? (
            <SkeletonRows />
          ) : (
            <>
              {s.today.map((r) => (
                <RowCard key={r.alert_id} row={r} utcOffsetMs={utcOffsetMs} onOpen={() => onOpen(r)} />
              ))}
              {s.groups.map((g, i) => (
                <ForGroup key={g.name} name={g.name} rows={g.rows} first={i === 0} utcOffsetMs={utcOffsetMs} onOpen={onOpen} />
              ))}
              {hasMore && (
                <button type="button" className="btn btn--quiet btn--block" onClick={onMore}>
                  {t('alerts.load_more')}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
