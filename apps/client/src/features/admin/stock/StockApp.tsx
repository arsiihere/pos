import { formatQuantity } from '@pos/domain';
import type { HubConfigStatus, HubStockItem, HubStockItemMeta } from '@pos/events';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { HubAdmin, HubError, StockVersions } from '../../../api/hub-admin';
import { createHubClock, hubTimeText, type HubClock } from '../../../app/hub-clock';
import { usePhone } from '../../../app/phone';
import { newUlid } from '../../../app/ulid';
import { ActionBar } from '../../../components/ActionBar';
import { AppBar } from '../../../components/AppBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { SideNav } from '../../../components/SideNav';
import { t, typeClass } from '../../../i18n';
import { adminErrorKey, fill } from '../../../i18n/en';
import { AdminLogin } from './AdminLogin';
import type { StockRow } from './badges';
import { AlertBar } from './AlertBar';
import { CloseDayButton, DayChip, type BusinessDay } from './BusinessDayBar';
import { ConfigChip, ConfigProblem } from './ConfigStatus';
import { draftKey, loadDraft, removeDraft, restoreDraft, saveDraft } from './draft';
import { StalePrompt } from './StalePrompt';
import { StartDay } from './StartDay';
import { shownOnHand, StockTable, toCount, type RowNote } from './StockTable';

// §8.2: stock query and config status on open and every 15 s while the page is visible.
export const REFRESH_MS = 15_000;
// §6.17: SetPrecookedStock takes 1–200 entries; a larger save is sent in parts (S56).
export const SAVE_CHUNK = 200;

// §8.2: no admin session → the roster and PIN pad; with one → the stock view. A `signed_out` answer
// (the hub ended the session) goes back to the roster.
export function StockApp({ api }: { api: HubAdmin }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  const signedOut = useCallback(() => setSignedIn(false), []);

  if (!signedIn) return <AdminLogin api={api} onLoggedIn={() => setSignedIn(true)} />;
  return <StockView api={api} onSignedOut={signedOut} />;
}

type Message = { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string; detail?: string };

// A save or Add refused with 409 BUSINESS_DAY_NOT_OPEN, re-sent with the same command_id after Start day.
type Blocked = { kind: 'save' } | { kind: 'add'; itemId: string; quantity: number };

function dayNotOpen(error: HubError): boolean {
  return error.kind === 'api' && error.code === 'BUSINESS_DAY_NOT_OPEN';
}

function errorMessage(error: HubError): Message {
  if (error.kind === 'network') return { tone: 'danger', text: t('admin_stock.errors.network') };
  if (error.kind === 'signed_out') return { tone: 'danger', text: t('errors.ADMIN_SESSION_REQUIRED') };
  return { tone: 'danger', text: t(adminErrorKey(error.code)) };
}

// Reading window.localStorage itself throws where site data is blocked (S55: the page works without it).
function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function tail(id: string): string {
  return `…${id.slice(-4)}`;
}

// S54 f: from tablet width the page sits in the 00-S20 hub admin shell (00 M86); on a phone it has only
// its own app bar.
function Shell({ branchId, children }: { branchId: string | null; children: ReactNode }) {
  const phone = usePhone();
  if (phone) return <div className="pos-page">{children}</div>;
  return (
    <div className="pos-page">
      <div className="pos-shell">
        <SideNav
          label={t('admin_stock.shell.title')}
          brand={{ title: branchId === null ? t('admin_stock.shell.title') : tail(branchId), sub: t('admin_stock.shell.title') }}
          items={[
            { href: '/admin#', icon: 'grid', label: t('admin_stock.shell.home') },
            { href: '/admin#devices', icon: 'screen', label: t('admin_stock.shell.devices') },
            { href: '/admin#sessions', icon: 'user', label: t('admin_stock.shell.sessions') },
            { href: '/admin#lockouts', icon: 'lock', label: t('admin_stock.shell.lockouts') },
            { href: '/admin/stock/', icon: 'box', label: t('admin_stock.title'), current: true },
          ]}
        />
        <div>{children}</div>
      </div>
    </div>
  );
}

function StockView({ api, onSignedOut }: { api: HubAdmin; onSignedOut: () => void }) {
  const [status, setStatus] = useState<HubConfigStatus | null>(null);
  const [meta, setMeta] = useState<readonly HubStockItemMeta[]>([]);
  const [items, setItems] = useState<readonly HubStockItem[]>([]);
  const [clock, setClock] = useState<HubClock | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [stale, setStale] = useState(false);
  const [staleAfterHours, setStaleAfterHours] = useState(16);
  const [minGapHours, setMinGapHours] = useState(4);
  // "Keep it open" hides the stale prompt until the page reloads.
  const [keepOpen, setKeepOpen] = useState(false);
  const [dayBusy, setDayBusy] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // S45: the per-row Add field values, kept across refreshes like the counts.
  const [adds, setAdds] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [offline, setOffline] = useState(false);
  // Every row whose Count the user touched (edited, even back to the same number, or confirmed).
  const [drafts, setDrafts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // B17: per-row feedback (added, a switch that failed).
  const [notes, setNotes] = useState<ReadonlyMap<string, RowNote>>(new Map());
  const [savedLine, setSavedLine] = useState<string | null>(null);
  // The stock query refused (403, 409, 500): shown until the next good answer.
  const [queryError, setQueryError] = useState<Message | null>(null);
  // S55: counts brought back after an idle sign-out, and rows saved by someone else since.
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<{ n: number; time: string; changed: string[] } | null>(null);
  const [askSignOut, setAskSignOut] = useState(false);
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const versions = useRef<StockVersions | undefined>(undefined);
  // D32: each save part's and each Add's command_id, kept for retries of the same entries.
  const pendingSaves = useRef(new Map<string, string>());
  const pendingAdds = useRef(new Map<string, { commandId: string; quantity: number }>());
  // S55: the row's set_at when its count was typed, so a kept count never overwrites a newer one.
  const bases = useRef(new Map<string, number | null>());
  const restoredOnce = useRef(false);

  // Only the latest refresh's answer is shown, so a slow older read never replaces a newer one.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    // D7: config-status is read on open, before any command, and gives the envelope's ids.
    const [config, stock] = await Promise.all([api.configStatus(), api.stock(versions.current)]);
    if (request !== latest.current) return;
    if ((!config.ok && config.error.kind === 'signed_out') || (!stock.ok && stock.error.kind === 'signed_out')) {
      onSignedOut();
      return;
    }
    if (config.ok) setStatus(config.data);
    if (!stock.ok) {
      // The hub is unreachable: keep the rows and what was typed.
      if (stock.error.kind === 'network') setOffline(true);
      else setQueryError(errorMessage(stock.error));
      return;
    }
    const answer = stock.data;
    setOffline(false);
    setQueryError(null);
    setClock(createHubClock(answer.hub_time));
    setStartedAt(answer.business_day_started_at);
    setDay(answer.business_day);
    setStale(answer.day_stale);
    setStaleAfterHours(answer.day_stale_after_hours);
    setMinGapHours(answer.day_min_gap_hours);
    versions.current = { meta_version: answer.meta_version, stock_version: answer.stock_version };
    // §6.19: an unchanged answer carries no item data; the rows stay.
    if (answer.items_meta !== null) setMeta(answer.items_meta);
    if (answer.items !== null) setItems(answer.items);
  }, [api, onSignedOut]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // S33: no day open (none yet, or the last one closed).
  const noDay = clock !== null && startedAt === null;
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const rows: StockRow[] = meta.flatMap((m) => {
    const item = byId.get(m.item_id);
    return item === undefined ? [] : [{ meta: m, item }];
  });
  const openDay = day !== null && day.closed_at === null ? day.opened_at : null;
  const branchId = status?.branch_id ?? null;
  const staffId = api.staffId();
  const key = branchId !== null && openDay !== null && staffId !== null ? draftKey(branchId, openDay, staffId) : null;

  // S55: once the rows, the day and the branch are known, bring back this person's kept counts.
  useEffect(() => {
    if (restoredOnce.current || branchId === null || openDay === null || staffId === null || rows.length === 0 || clock === null) return;
    restoredOnce.current = true;
    const draft = loadDraft(localStore(), branchId, openDay, staffId);
    if (draft === null) return;
    const { touched, changed } = restoreDraft(draft, rows);
    for (const entry of draft.entries) if (touched.has(entry.item_id)) bases.current.set(entry.item_id, entry.base_set_at);
    if (touched.size > 0) {
      setDrafts((d) => new Map([...touched, ...d]));
      setRestored(new Set(touched.keys()));
    }
    if (touched.size > 0 || changed.length > 0) {
      setKept({
        n: touched.size,
        time: hubTimeText(draft.saved_at, clock.utcOffsetMs),
        changed: changed.map((c) => `${c.name} (${formatQuantity(c.now, rows.find((r) => r.meta.item_id === c.item_id)?.meta.stock_unit ?? 'piece')})`),
      });
    }
  });

  // S55: every edit while a day is open is written to this tablet; an empty draft is removed.
  useEffect(() => {
    if (key === null || clock === null) return;
    const entries = [...drafts].flatMap(([id, value]) => {
      const row = rows.find((r) => r.meta.item_id === id);
      return value === null || row === undefined
        ? []
        : [{ item_id: id, on_hand: value, unit: row.meta.stock_unit, base_set_at: bases.current.get(id) ?? row.item.set_at }];
    });
    saveDraft(localStore(), key, { saved_at: clock.nowMs(), entries });
    // rows and clock are read, not watched: only an edit (or a new day or person) writes.
  }, [drafts, key]);

  const edit = (itemId: string, value: number | null) => {
    if (!bases.current.has(itemId)) bases.current.set(itemId, byId.get(itemId)?.set_at ?? null);
    setSavedLine(null);
    setDrafts((d) => new Map(d).set(itemId, value));
  };
  const confirm = (itemId: string) => {
    const row = rows.find((r) => r.meta.item_id === itemId);
    if (row !== undefined) edit(itemId, shownOnHand(row));
  };

  // S56: rows carried over from the last day, still unconfirmed.
  const carried = rows.filter(
    (r) =>
      r.meta.is_stock_tracked &&
      r.meta.carries_over &&
      startedAt !== null &&
      shownOnHand(r) !== null &&
      r.item.set_at !== null &&
      r.item.set_at < startedAt,
  );
  const carriedOpen = carried.filter((r) => !drafts.has(r.meta.item_id));

  const save = async (override?: ReadonlyMap<string, number | null>) => {
    const current = override ?? drafts;
    // Config order; a cleared input has no number to send.
    const entries = rows.flatMap(({ meta: m }) => {
      const value = current.get(m.item_id);
      return m.is_stock_tracked && value !== undefined && value !== null ? [{ item_id: m.item_id, on_hand: value }] : [];
    });
    if (entries.length === 0) {
      setMessage({ tone: 'info', text: t('admin_stock.nothing_to_save') });
      return;
    }
    setSaving(true);
    setMessage(null);
    const saved: typeof entries = [];
    let failure: HubError | null = null;
    for (let i = 0; i < entries.length; i += SAVE_CHUNK) {
      const part = entries.slice(i, i + SAVE_CHUNK);
      const partKey = JSON.stringify(part);
      const commandId = pendingSaves.current.get(partKey) ?? newUlid();
      pendingSaves.current.set(partKey, commandId);
      const answer = await api.setPrecookedStock({ entries: part }, commandId);
      if (!answer.ok) {
        failure = answer.error;
        break;
      }
      pendingSaves.current.delete(partKey);
      saved.push(...part);
    }
    setSaving(false);
    if (saved.length > 0) {
      setDrafts((d) => {
        const next = new Map(d);
        for (const e of saved) {
          if (next.get(e.item_id) === e.on_hand) {
            next.delete(e.item_id);
            bases.current.delete(e.item_id);
          }
        }
        return next;
      });
      setRestored((r) => new Set([...r].filter((id) => !saved.some((e) => e.item_id === id))));
    }
    if (failure !== null) {
      if (failure.kind === 'signed_out') onSignedOut();
      else if (dayNotOpen(failure)) setBlocked({ kind: 'save' });
      else if (failure.kind === 'api' && (failure.code === 'STOCK_NOT_TRACKED' || failure.code === 'MENU_ITEM_NOT_FOUND')) {
        const gone = rows.find((r) => r.meta.item_id === failure?.details['item_id'])?.meta.name ?? '';
        setMessage({ tone: 'info', text: fill(t('admin_stock.not_counted_now'), { name: gone }) });
        await refresh();
      } else setMessage(errorMessage(failure));
      return;
    }
    setKept(null);
    setSavedLine(
      fill(t('admin_stock.saved_at'), { n: String(saved.length), time: clock === null ? '' : hubTimeText(clock.nowMs(), clock.utcOffsetMs) }),
    );
    await refresh();
  };

  // S56: every untouched carried-over row is confirmed with its shown count, then one Save counts.
  const confirmAll = async () => {
    const next = new Map(drafts);
    for (const row of carriedOpen) {
      if (!bases.current.has(row.meta.item_id)) bases.current.set(row.meta.item_id, row.item.set_at);
      next.set(row.meta.item_id, shownOnHand(row));
    }
    setDrafts(next);
    await save(next);
  };

  const add = async (itemId: string, given?: number) => {
    const quantity = given ?? adds.get(itemId);
    if (quantity === undefined || quantity === null || quantity === 0) return;
    const pending = pendingAdds.current.get(itemId);
    const commandId = pending?.quantity === quantity ? pending.commandId : newUlid();
    pendingAdds.current.set(itemId, { commandId, quantity });
    setMessage(null);
    setNotes((n) => new Map(n).set(itemId, { tone: 'info', text: t('admin_stock.adding') }));
    const answer = await api.addPrecookedStock({ entries: [{ item_id: itemId, quantity }] }, commandId);
    setNotes((n) => {
      const next = new Map(n);
      next.delete(itemId);
      return next;
    });
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else if (dayNotOpen(answer.error)) setBlocked({ kind: 'add', itemId, quantity });
      else setMessage(errorMessage(answer.error));
      return;
    }
    pendingAdds.current.delete(itemId);
    const unit = rows.find((r) => r.meta.item_id === itemId)?.meta.stock_unit ?? 'piece';
    setNotes((n) => new Map(n).set(itemId, { tone: 'ok', text: fill(t('admin_stock.added'), { n: formatQuantity(quantity, unit) }) }));
    setAdds((a) => {
      const next = new Map(a);
      if (next.get(itemId) === quantity) next.delete(itemId);
      return next;
    });
    await refresh();
  };

  // One tap, no confirmation; then the refused save or Add, if any, goes again with its command_id.
  const startDay = async () => {
    setDayBusy(true);
    setMessage(null);
    const answer = await api.openBusinessDay(newUlid());
    setDayBusy(false);
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else setMessage(errorMessage(answer.error));
      return;
    }
    const retry = blocked;
    setBlocked(null);
    if (retry?.kind === 'save') await save();
    else if (retry?.kind === 'add') await add(retry.itemId, retry.quantity);
    else await refresh();
  };

  const closeDay = async (): Promise<boolean> => {
    setDayBusy(true);
    setMessage(null);
    const answer = await api.closeBusinessDay(newUlid());
    setDayBusy(false);
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else setMessage(errorMessage(answer.error));
      return false;
    }
    if (answer.data.reason === 'opened_recently') {
      setMessage({
        tone: 'info',
        text: fill(t('admin_stock.day.opened_recently'), { hours: String(minGapHours) }),
        detail:
          day === null || clock === null
            ? undefined
            : fill(t('admin_stock.day.opened_recently_small'), { time: hubTimeText(day.opened_at, clock.utcOffsetMs) }),
      });
      return false;
    }
    await refresh();
    return true;
  };

  // S33: two commands, two command_ids.
  const closeAndStart = async () => {
    if (await closeDay()) await startDay();
  };

  const toggle = async (itemId: string, isAvailable: boolean) => {
    setMessage(null);
    const answer = await api.setItemAvailability({ item_id: itemId, is_available: isAvailable }, newUlid());
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else {
        setNotes((n) =>
          new Map(n).set(itemId, { tone: 'danger', text: t(isAvailable ? 'admin_stock.switch_on_failed' : 'admin_stock.switch_off_failed') }),
        );
        if (answer.error.kind !== 'network') setMessage(errorMessage(answer.error));
      }
      return;
    }
    setNotes((n) => {
      const next = new Map(n);
      next.delete(itemId);
      return next;
    });
    await refresh();
  };

  const discardKept = () => {
    setDrafts(new Map());
    bases.current.clear();
    setRestored(new Set());
    setKept(null);
    if (key !== null) removeDraft(localStore(), key);
  };

  // Q3, S54 e: sign out ends the session on the hub; unsaved counts ask first.
  const signOut = async (then: 'keep' | 'discard' | 'save' | 'none') => {
    setAskSignOut(false);
    if (then === 'save') await save();
    if (then === 'discard') discardKept();
    await api.logout();
    onSignedOut();
  };

  const touched = [...drafts.values()].filter((v) => v !== null).length;
  const tracked = rows.filter((r) => r.meta.is_stock_tracked);
  const countedToday = tracked.filter((r) => !toCount(r, startedAt)).length;
  const name = api.adminName();

  const info = offline ? (
    <>
      <strong>{fill(t('admin_stock.waiting'), { n: String(touched) })}</strong>
      <span>{t('admin_stock.waiting_body')}</span>
    </>
  ) : kept !== null && restored.size > 0 ? (
    <>
      <strong>{fill(t('admin_stock.kept.not_saved'), { n: String(restored.size) })}</strong>
      <span>{t('admin_stock.kept.on_device')}</span>
    </>
  ) : savedLine !== null ? (
    <>
      <strong className="pos-ltr">{savedLine}</strong>
      {countedToday === tracked.length && tracked.length > 0 && <span>{t('admin_stock.all_counted')}</span>}
    </>
  ) : (
    <>
      <strong className="pos-ltr">{fill(t('admin_stock.counted_n'), { n: String(countedToday), m: String(tracked.length) })}</strong>
      <span>{t('admin_stock.save_help')}</span>
    </>
  );

  return (
    <Shell branchId={branchId}>
      <AppBar
        title={t('admin_stock.title')}
        after={
          <>
            {clock !== null && <DayChip day={day} clock={clock} staleAfterHours={staleAfterHours} />}
            {status !== null && <ConfigChip status={status} clock={clock} />}
          </>
        }
      >
        {name !== null && <span className={typeClass('body')}>{fill(t('admin_stock.signed_in_as'), { name })}</span>}
        <button type="button" className="pos-btn" onClick={() => (touched > 0 ? setAskSignOut(true) : void signOut('none'))}>
          {t('admin_stock.sign_out')}
        </button>
        {clock !== null && day !== null && day.closed_at === null && (
          <CloseDayButton
            day={day}
            clock={clock}
            busy={dayBusy}
            keepsOvernight={tracked.filter((r) => r.meta.carries_over).map((r) => r.meta.name)}
            switchedOff={rows.filter((r) => !r.item.is_available).map((r) => r.meta.name)}
            onClose={() => void closeDay()}
          />
        )}
      </AppBar>
      <main className="pos-content" data-view="stock">
        {status !== null && <ConfigProblem status={status} />}
        {offline && <Banner tone="warn" text={t('admin_stock.reconnecting')} detail={t('admin_stock.reconnecting_body')} />}
        {queryError !== null && <Banner tone={queryError.tone} text={queryError.text} />}
        {message !== null && <Banner tone={message.tone} text={message.text} detail={message.detail} />}
        {kept !== null && (
          <div className="pos-callout" data-kept="">
            <div className="pos-callout__text">
              <h2>{fill(t('admin_stock.kept.title'), { n: String(kept.n), time: kept.time })}</h2>
              <p>
                {t('admin_stock.kept.body')}
                {kept.changed.length > 0 && ` ${fill(t('admin_stock.kept.changed'), { items: kept.changed.join(', ') })}`}
              </p>
            </div>
            <button type="button" className="pos-btn" onClick={discardKept}>
              {t('admin_stock.kept.discard')}
            </button>
          </div>
        )}
        {clock !== null && stale && !keepOpen && day !== null && (
          <StalePrompt
            openedAt={day.opened_at}
            clock={clock}
            busy={dayBusy}
            onCloseAndStart={() => void closeAndStart()}
            onKeep={() => setKeepOpen(true)}
          />
        )}
        {clock !== null && noDay && <StartDay place="rows" busy={dayBusy} onStart={() => void startDay()} />}
        {blocked !== null && (
          <StartDay place="retry" busy={dayBusy} primary waiting={touched} onStart={() => void startDay()} />
        )}
        {!noDay && carriedOpen.length > 0 && (
          <section className="pos-callout pos-callout--accent" data-carry="">
            <div className="pos-callout__text">
              <h2>{fill(t('admin_stock.carry.title'), { n: String(carriedOpen.length) })}</h2>
              <p>{t('admin_stock.carry.body')}</p>
            </div>
            <BusyButton busy={saving} onClick={() => void confirmAll()}>
              {fill(t('admin_stock.carry.all'), { n: String(carriedOpen.length) })}
            </BusyButton>
          </section>
        )}
        <AlertBar rows={rows} onPick={(id) => setFocus({ id })} />
        {clock !== null && (
          <StockTable
            rows={rows}
            startedAt={startedAt}
            clock={clock}
            drafts={drafts}
            onEdit={edit}
            onConfirm={confirm}
            onToggle={(id, next) => void toggle(id, next)}
            adds={adds}
            onAddEdit={(id, v) => setAdds((a) => new Map(a).set(id, v))}
            onAdd={(id, quantity) => void add(id, quantity)}
            notes={notes}
            restored={restored}
            focusId={focus}
          />
        )}
      </main>
      <ActionBar info={info}>
        {kept !== null && restored.size > 0 && (
          <button type="button" className="pos-btn" onClick={discardKept}>
            {t('admin_stock.kept.discard')}
          </button>
        )}
        {blocked === null && (
          <span data-save="">
            <BusyButton primary={!noDay} busy={saving} onClick={() => void save()}>
              {touched === 0
                ? t('admin_stock.save')
                : fill(t(touched === 1 ? 'admin_stock.save_one' : 'admin_stock.save_n'), { n: String(touched) })}
            </BusyButton>
          </span>
        )}
      </ActionBar>
      {askSignOut && (
        <Dialog
          title={fill(t('admin_stock.sign_out_ask'), { n: String(touched) })}
          onClose={() => setAskSignOut(false)}
          footer={
            <>
              <button type="button" className="pos-btn pos-btn--danger" onClick={() => void signOut('discard')}>
                {t('admin_stock.kept.discard')}
              </button>
              <button type="button" className="pos-btn" onClick={() => void signOut('keep')}>
                {t('admin_stock.sign_out_keep')}
              </button>
              <button type="button" className="pos-btn pos-btn--primary" onClick={() => void signOut('save')}>
                {t('admin_stock.save')}
              </button>
            </>
          }
        >
          <p className="pos-dialog__body">{t('admin_stock.sign_out_body')}</p>
        </Dialog>
      )}
    </Shell>
  );
}
