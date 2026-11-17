import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { initial } from '../alerts/ui';
import { money, MONEY_DIR } from '../staff/orders/money';
import { useShell } from '../staff/shell/hooks';
import type { AuditEntryView, AuditQuery } from './api';
import { dayCount, dayStart, dayText, presetOf, rangeInSentence, rangeText, todayRange, type DayRange } from './days';
import { collect, csvOf, exportFileName, saveInBrowser } from './export';
import { ActionsPopover, DatePopover, StaffPopover } from './Filters';
import { AIco, type AuditIconName } from './icons';
import { actionMeta, actionText, detailOf, methodOf, outcomeOf, reasonText, shortId, targetOf, VOIDS_PRESET, type AuditTone } from './labels';

// 04 v1.0.4 §8 Audit log screen (VU2; 04-S03, frames Audit, AuditLoading, AuditEmpty, AuditError, AuditTablet, AuditUrdu):
// `view-audit-log` only (R5). Filters Date (default today on the hub clock, whole days, [from, to)), Staff, Actions;
// newest first; infinite scroll by `meta.next_cursor` (a failed next page keeps the rows, MAPPING Gaps); laptop rows
// in 8 columns, the tablet (≤ 1359 px wide) in two-line rows with day headers when the range has several days.

const TABLET = '(max-width: 1359px)';
const SKELETON_ROWS = 10;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const list = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
      list?.addEventListener('change', fn);
      return () => list?.removeEventListener('change', fn);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
  );
}

export interface AuditFilters {
  range: DayRange;
  /** one person, as actor or approver (§6.5 staff_id); null = Everyone */
  staff: { staff_id: string; name: string } | null;
  /** empty = All actions */
  actions: readonly string[];
}

export function queryOf(f: AuditFilters): AuditQuery {
  return { from: f.range.from, to: f.range.to, staff_id: f.staff?.staff_id ?? null, actions: f.actions };
}

type ListState =
  | { status: 'loading' }
  | { status: 'error'; network: boolean }
  | { status: 'ready'; entries: AuditEntryView[]; cursor: string | null; more: 'idle' | 'loading' | 'failed' };

const Dash = () => <span className="dash">—</span>;

/** The filters' actions value: "All actions", "Voids" (the 4-action preset), one action's words, "3 actions". */
export function actionsValue(actions: readonly string[]): string {
  if (actions.length === 0) return t('audit.f.all_actions');
  if (actions.length === VOIDS_PRESET.length && VOIDS_PRESET.every((a) => actions.includes(a))) return t('audit.f.preset.voids');
  if (actions.length === 1) return actionText(actions[0]!);
  return fill(t('audit.f.n_actions'), { n: String(actions.length) });
}

function emptyActionsWord(actions: readonly string[]): string {
  if (actions.length === 0) return t('audit.empty.entries');
  if (actions.length === VOIDS_PRESET.length && VOIDS_PRESET.every((a) => actions.includes(a))) return t('audit.empty.voids');
  if (actions.length === 1) return actionText(actions[0]!);
  return fill(t('audit.empty.n_actions'), { n: String(actions.length) });
}

export interface AuditLogProps {
  /** tests: where the CSV goes; default a browser download */
  save?: (name: string, text: string) => void;
}

export function AuditLog({ save = saveInBrowser }: AuditLogProps = {}) {
  const shell = useShell();
  const off = shell.clock.utcOffsetMs;
  const tablet = useMedia(TABLET);
  // the shell's staff api (shell/hooks.ts: a lane never builds its own): §6.5 / §6.5b through its fetch and session
  const api = shell.api;
  const defaults = useCallback((): AuditFilters => ({ range: todayRange(shell.clock.nowMs(), off), staff: null, actions: [] }), [shell.clock, off]);
  const [filters, setFilters] = useState<AuditFilters>(defaults);
  const [list, setList] = useState<ListState>({ status: 'loading' });
  // one filter popover at a time (04-C04–C06); closing gives the focus back to its filter
  const [open, setOpen] = useState<'date' | 'staff' | 'actions' | null>(null);
  const fltRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const close = useCallback(() => {
    setOpen((was) => {
      if (was !== null) fltRefs.current[was]?.focus();
      return null;
    });
  }, []);
  const apply = useCallback((next: Partial<AuditFilters>) => {
    setOpen((was) => {
      if (was !== null) fltRefs.current[was]?.focus();
      return null;
    });
    setFilters((f) => ({ ...f, ...next }));
  }, []);
  const gen = useRef(0);
  // one next page in flight at a time (the observer and Try again can both ask before a render)
  const moreInFlight = useRef(false);

  const loadFirst = useCallback(
    async (f: AuditFilters) => {
      gen.current += 1;
      moreInFlight.current = false;
      const mine = gen.current;
      setList({ status: 'loading' });
      const answer = await api.auditLog(queryOf(f), null);
      if (mine !== gen.current) return; // a newer filter's reply wins
      if (!answer.ok) setList({ status: 'error', network: answer.error.kind === 'network' });
      else setList({ status: 'ready', entries: answer.data.entries, cursor: answer.data.next_cursor, more: 'idle' });
    },
    [api],
  );

  useEffect(() => {
    void loadFirst(filters);
  }, [filters, loadFirst]);

  const loadMore = useCallback(async () => {
    if (moreInFlight.current || list.status !== 'ready' || list.cursor === null || list.more === 'loading') return;
    moreInFlight.current = true;
    const mine = gen.current;
    const cursor = list.cursor;
    setList({ ...list, more: 'loading' });
    const answer = await api.auditLog(queryOf(filters), cursor);
    moreInFlight.current = false;
    if (mine !== gen.current) return;
    setList((now) => {
      if (now.status !== 'ready') return now;
      if (!answer.ok) return { ...now, more: 'failed' };
      // the cursor key (recorded_at, seq) is unique (§6.5): a page never repeats a row
      return { status: 'ready', entries: [...now.entries, ...answer.data.entries], cursor: answer.data.next_cursor, more: 'idle' };
    });
  }, [api, filters, list]);

  // infinite scroll: the end row coming into view asks for the next page
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef(loadMore);
  moreRef.current = loadMore;
  const ready = list.status === 'ready';
  useEffect(() => {
    const end = endRef.current;
    if (!ready || end === null || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) void moreRef.current();
    }, { root: bodyRef.current, rootMargin: '0px 0px 240px 0px' });
    io.observe(end);
    return () => io.disconnect();
  }, [ready]);

  // 04-D09 Export CSV (V17): rows so far and the share of the range they reach back to (newest first)
  const [exporting, setExporting] = useState<{ rows: number; pct: number } | null>(null);
  const stopRef = useRef<{ stopped: boolean } | null>(null);
  useEffect(() => () => {
    if (stopRef.current !== null) stopRef.current.stopped = true;
  }, []);
  const runExport = async () => {
    if (exporting !== null || list.status !== 'ready' || list.entries.length === 0) return;
    const run = { stopped: false };
    stopRef.current = run;
    const f = filters;
    const span = f.range.to - f.range.from;
    setExporting({ rows: 0, pct: 0 });
    const result = await collect(
      api,
      queryOf(f),
      (rows, oldest) => !run.stopped && setExporting({ rows, pct: oldest === null ? 100 : Math.min(100, Math.max(0, ((f.range.to - oldest) / span) * 100)) }),
      () => run.stopped,
    );
    if (stopRef.current === run) stopRef.current = null;
    if (result.kind === 'stopped') return;
    setExporting(null);
    if (result.kind === 'failed') {
      shell.toasts.show({ text: t(result.network ? 'audit.export.failed' : 'audit.export.refused'), tone: 'warn' });
      return;
    }
    const name = exportFileName(shell.meta.branchName, f.range, off);
    save(name, csvOf(result.entries, off));
    shell.toasts.show({ text: fill(t('audit.export.saved'), { file: name }) });
  };
  const stopExport = () => {
    if (stopRef.current !== null) stopRef.current.stopped = true;
    stopRef.current = null;
    setExporting(null);
    shell.toasts.show({ text: t('audit.export.stopped'), tone: 'info' });
  };

  if (!shell.permissions.allowed('view-audit-log')) return null;

  const nowMs = shell.clock.nowMs();
  const isToday = presetOf(filters.range, nowMs, off) === 'today';
  const exportOff = exporting !== null || list.status !== 'ready' || list.entries.length === 0;

  const bar = (
    <div className="au__bar">
      <FilterButton
        id="date"
        refs={fltRefs.current}
        open={open === 'date'}
        onToggle={() => setOpen((o) => (o === 'date' ? null : 'date'))}
        icon="cal"
        label={t('audit.f.date')}
        value={rangeText(filters.range, nowMs, off)}
        set={!isToday}
      >
        {open === 'date' && <DatePopover range={filters.range} nowMs={nowMs} utcOffsetMs={off} onApply={(range) => apply({ range })} onClose={close} />}
      </FilterButton>
      <FilterButton
        id="staff"
        refs={fltRefs.current}
        open={open === 'staff'}
        onToggle={() => setOpen((o) => (o === 'staff' ? null : 'staff'))}
        icon="user"
        label={t('audit.f.staff')}
        value={filters.staff?.name ?? t('audit.f.everyone')}
        set={filters.staff !== null}
      >
        {open === 'staff' && <StaffPopover api={api} selected={filters.staff?.staff_id ?? null} onPick={(staff) => apply({ staff })} onClose={close} />}
      </FilterButton>
      <FilterButton
        id="actions"
        refs={fltRefs.current}
        open={open === 'actions'}
        onToggle={() => setOpen((o) => (o === 'actions' ? null : 'actions'))}
        icon="filter"
        label={t('audit.f.actions')}
        value={actionsValue(filters.actions)}
        set={filters.actions.length > 0}
        count={filters.actions.length > 1 ? filters.actions.length : null}
      >
        {open === 'actions' && <ActionsPopover selected={filters.actions} onApply={(actions) => apply({ actions })} onClose={close} />}
      </FilterButton>
      <div className="end">
        <span className="cap">{t('audit.caption')}</span>
        <button type="button" className="btn" aria-disabled={exportOff ? 'true' : undefined} onClick={() => void runExport()}>
          <AIco name="download" />
          {exporting === null ? t('audit.export') : t('audit.export.running')}
        </button>
      </div>
    </div>
  );
  const xbar = exporting === null ? null : <ExportBar rows={exporting.rows} pct={exporting.pct} onStop={stopExport} />;

  const head = tablet ? (
    <div className="aur aur--t th">
      <span>{t('audit.col.time')}</span>
      <span>{t('audit.col.what')}</span>
      <span>{t('audit.col.who')}</span>
      <span className="r">{t('audit.col.outcome_amount')}</span>
    </div>
  ) : (
    <div className="aur th">
      <span>{t('audit.col.time')}</span>
      <span>{t('audit.col.who')}</span>
      <span>{t('audit.col.action')}</span>
      <span>{t('audit.col.target')}</span>
      <span>{t('audit.col.reason')}</span>
      <span>{t('audit.col.outcome')}</span>
      <span className="r">{t('audit.col.amount')}</span>
      <span>{t('audit.col.approver')}</span>
    </div>
  );

  let content: ReactNode;
  if (list.status === 'loading') {
    content = (
      <div className="au__body" aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className="aur aur--sk">
            {Array.from({ length: 8 }, (_, j) => (
              <span key={j} className="sk" />
            ))}
          </div>
        ))}
      </div>
    );
  } else if (list.status === 'error') {
    content = (
      <div className="empty" role="alert">
        <BigRing tone="danger" icon="wifioff" />
        <b>{list.network ? t('audit.err.title') : t('audit.err.refused')}</b>
        {list.network && <span>{t('audit.err.body')}</span>}
        <button type="button" className="btn" onClick={() => void loadFirst(filters)}>
          <AIco name="retry" />
          {t('audit.err.retry')}
        </button>
      </div>
    );
  } else if (list.entries.length === 0) {
    const date = rangeInSentence(filters.range, off);
    const actions = emptyActionsWord(filters.actions);
    content = (
      <div className="empty">
        <BigRing tone="mute" icon="list" />
        <b>{t('audit.empty.title')}</b>
        <span>
          {filters.staff === null ? fill(t('audit.empty.body_all'), { actions, date }) : fill(t('audit.empty.body'), { actions, name: filters.staff.name, date })}
        </span>
        <button type="button" className="btn" onClick={() => setFilters(defaults())}>
          {t('audit.empty.clear')}
        </button>
      </div>
    );
  } else {
    const days = dayCount(filters.range) > 1;
    const rows: ReactNode[] = [];
    if (tablet) {
      let day: number | null = null;
      const counts = new Map<number, number>();
      for (const e of list.entries) {
        const d = dayStart(e.recorded_at, off);
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      for (const e of list.entries) {
        const d = dayStart(e.recorded_at, off);
        if (days && d !== day) {
          day = d;
          const today = d === dayStart(nowMs, off);
          rows.push(
            <div key={`day-${d}`} className="au__day">
              {today ? fill(t('audit.day.today'), { date: dayText(d, off) }) : dayText(d, off)}
              <span className="end num">{counts.get(d)}</span>
            </div>,
          );
        }
        rows.push(<TabletRow key={e.seq} e={e} off={off} />);
      }
    } else {
      for (const e of list.entries) rows.push(<LaptopRow key={e.seq} e={e} off={off} />);
    }
    let end: ReactNode;
    if (list.more === 'failed') {
      end = (
        <>
          {t('audit.more_failed')} ·
          <button type="button" className="btn btn--quiet" onClick={() => void loadMore()}>
            {t('audit.err.retry')}
          </button>
        </>
      );
    } else if (list.cursor !== null) {
      end = (
        <>
          <span className="spin" aria-hidden="true" />
          {t('audit.loading_more')}
        </>
      );
    } else {
      end = isToday ? t('audit.end_today') : t('audit.end');
    }
    content = (
      <div className="au__body" ref={bodyRef}>
        {rows}
        <div className="au__end" ref={endRef} role="status">
          {end}
        </div>
      </div>
    );
  }

  return (
    <main className="au" aria-label={t('audit.tab')}>
      {bar}
      {xbar}
      <div className="aul">
        {head}
        {content}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------------------------------------ parts

function FilterButton({
  id,
  refs,
  open,
  onToggle,
  icon,
  label,
  value,
  set,
  count = null,
  children,
}: {
  id: string;
  refs: Record<string, HTMLButtonElement | null>;
  open: boolean;
  onToggle: () => void;
  icon: AuditIconName;
  label: string;
  value: string;
  set: boolean;
  count?: number | null;
  children?: ReactNode;
}) {
  return (
    <div className="flt-w">
      <button
        type="button"
        ref={(el) => {
          refs[id] = el;
        }}
        className={`flt${set ? ' is-set' : ''}${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        <AIco name={icon} />
        <span>
          <small>{label}</small>
          <b>
            {value}
            {count !== null && <span className="n">{count}</span>}
          </b>
        </span>
        <AIco name="down" />
      </button>
      {children}
    </div>
  );
}

/** Frame AuditExport: "Exporting… 1,250 rows", the progress track, Stop. */
function ExportBar({ rows, pct, onStop }: { rows: number; pct: number; onStop: () => void }) {
  const [before, after = ''] = t('audit.export.rows').split('{n}');
  return (
    <div className="xbar" role="status">
      <AIco name="download" />
      <span>
        {before}
        <span className="num">{rows.toLocaleString('en-US')}</span>
        {after}
      </span>
      <span className="trk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <i
          ref={(el) => {
            if (el !== null) el.style.width = `${pct.toFixed(1)}%`;
          }}
        />
      </span>
      <button type="button" className="btn" onClick={onStop}>
        {t('audit.export.stop')}
      </button>
    </div>
  );
}

function BigRing({ tone, icon }: { tone: AuditTone; icon: AuditIconName }) {
  return (
    <span className={`ring ring--88 c-${tone}`}>
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle className="trk" cx="44" cy="44" r="41.5" strokeWidth="5" />
        <circle className="val" cx="44" cy="44" r="41.5" pathLength={100} strokeWidth="5" strokeDasharray="0 100" />
      </svg>
      <span className="ring__in">
        <AIco name={icon} />
      </span>
    </span>
  );
}

function Who({ e }: { e: AuditEntryView }) {
  if (e.actor_name !== null)
    return (
      <span className="who">
        <span className="av">{initial(e.actor_name)}</span>
        {e.actor_name}
      </span>
    );
  if (e.actor_staff_id === null) return <Dash />;
  // an id with no name in staff_names (frame Audit: "?" and the shortened id, O1)
  return (
    <span className="who">
      <span className="av">?</span>
      <span className="id ltr">{shortId(e.actor_staff_id)}</span>
    </span>
  );
}

function Action({ action }: { action: string }) {
  const m = actionMeta(action);
  return (
    <span className={`act c-${m.tone}`}>
      <i>
        <AIco name={m.icon} />
      </i>
      {actionText(action)}
    </span>
  );
}

function Outcome({ outcome }: { outcome: string | null }) {
  const o = outcomeOf(outcome);
  if (o === null) return outcome === null ? <Dash /> : <span className="rs">{outcome}</span>;
  return (
    <span className={`oc c-${o.tone}`}>
      <AIco name={o.icon} />
      {o.text}
    </span>
  );
}

function approverName(e: AuditEntryView): string | null {
  if (e.approver_name !== null) return e.approver_name;
  return e.approver_staff_id === null ? null : shortId(e.approver_staff_id);
}

function Target({ e, detail }: { e: AuditEntryView; detail: Record<string, unknown> }) {
  const target = targetOf(e, detail);
  if (target.table === null && target.text === null) return <Dash />;
  return (
    <>
      {target.table !== null && <span className="tcode tcode--sm ltr">{target.table}</span>}
      {target.text !== null && <b>{target.text}</b>}
    </>
  );
}

function LaptopRow({ e, off }: { e: AuditEntryView; off: number }) {
  const detail = detailOf(e);
  const reason = reasonText(e.action, e.reason);
  const approver = approverName(e);
  const method = methodOf(e, detail);
  return (
    <div className="aur">
      <span className="t">{timeText(e.recorded_at, off)}</span>
      <Who e={e} />
      <Action action={e.action} />
      <span className="tg">
        <Target e={e} detail={detail} />
      </span>
      <span className="rs">{reason ?? <Dash />}</span>
      <Outcome outcome={e.outcome} />
      <span className="am" dir={MONEY_DIR}>
        {e.amount_minor === null ? <Dash /> : money(e.amount_minor)}
      </span>
      {approver === null ? (
        <Dash />
      ) : (
        <span className="ap">
          <span>{approver}</span>
          {method !== null && (
            <span className="atag c-info">
              <AIco name={method === 'in_person' ? 'user' : 'tablet'} />
              {t(method === 'in_person' ? 'audit.method.in_person' : 'audit.method.on_requester_device')}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function TabletRow({ e, off }: { e: AuditEntryView; off: number }) {
  const detail = detailOf(e);
  const reason = reasonText(e.action, e.reason);
  const approver = approverName(e);
  const method = methodOf(e, detail);
  const target = targetOf(e, detail);
  return (
    <div className="aur aur--t">
      <span className="t">{timeText(e.recorded_at, off)}</span>
      <span className="stack">
        <Action action={e.action} />
        {(target.table !== null || target.text !== null) && (
          <span className="sub">
            {target.table !== null && <span className="tcode tcode--sm ltr">{target.table}</span>} {target.text !== null && <b>{target.text}</b>}
          </span>
        )}
        {reason !== null && <span className="sub2">“{reason}”</span>}
      </span>
      <span className="stack">
        <Who e={e} />
        {approver !== null && <ApproverLine name={approver} method={method} />}
      </span>
      <span className="rgt">
        {e.outcome !== null && <Outcome outcome={e.outcome} />}
        {e.amount_minor !== null && (
          <span className="am" dir={MONEY_DIR}>
            {money(e.amount_minor)}
          </span>
        )}
      </span>
    </div>
  );
}

/** "Approver Imran · in person" (frame AuditTablet; §8 words in a sentence, lower case). */
function ApproverLine({ name, method }: { name: string; method: 'in_person' | 'on_requester_device' | null }) {
  const text = method === null ? t('audit.approver_line') : t('audit.approver_line.method');
  const [before, after = ''] = text.split('{name}');
  const methodWord = method === null ? '' : t(method === 'in_person' ? 'audit.method.in_person.inline' : 'audit.method.on_requester_device.inline');
  return (
    <span className="sub2">
      {before}
      <b>{name}</b>
      {fill(after, { method: methodWord })}
    </span>
  );
}
