import { formatQuantity } from '@pos/domain';
import type { HubConfigStatus, HubStockItem, HubStockItemMeta, HubStockRow, HubStockRowMeta } from '@pos/events';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { HubAdmin, HubError, StockVersions } from '../../../api/hub-admin';
import { createHubClock, hubTimeText, type HubClock } from '../../../app/hub-clock';
import { usePhone } from '../../../app/phone';
import { newUlid } from '../../../app/ulid';
import { AppBar } from '../../../components/AppBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { MoreMenu, type MoreMenuItem } from '../../../components/MoreMenu';
import { SideNav } from '../../../components/SideNav';
import { t } from '../../../i18n';
import { adminErrorKey, fill } from '../../../i18n/en';
import { AdminLogin } from './AdminLogin';
import { pageRows } from './badges';
import { AlertBar } from './AlertBar';
import { CloseDayDialog, DayChip, type BusinessDay } from './BusinessDayBar';
import { ConfigChip, ConfigProblem, MenuStatus } from './ConfigStatus';
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

type Message = { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string; detail?: string; items?: string[] };

// A save or Add refused with 409 BUSINESS_DAY_NOT_OPEN, re-sent with the same command_id after Start day.
type Blocked = { kind: 'save' } | { kind: 'add'; stockItemId: string; quantity: number };

function dayNotOpen(error: HubError): boolean {
  return error.kind === 'api' && error.code === 'BUSINESS_DAY_NOT_OPEN';
}

// 01b §4.4 row 11: a `my_stations` counter changed an item of another station.
function outsideScope(error: HubError): boolean {
  return error.kind === 'api' && error.code === 'PERMISSION_DENIED' && error.details['reason'] === 'outside_scope';
}

// 01a v2.5 §8.2 (04 §4.5 A-1, G-21): 409 DAY_CLOSE_BLOCKED { reason, voids (≤ 40), count } → the count
// text and one row per void (identifier · item · requester), plus "and N more" when count > the list.
// Missing or malformed details (an old hub) → the generic error text, no list.
function dayCloseBlocked(details: Record<string, unknown>): Message {
  const raw: unknown = details['voids'];
  const count: unknown = details['count'];
  const generic: Message = { tone: 'danger', text: t(adminErrorKey('DAY_CLOSE_BLOCKED')) };
  if (!Array.isArray(raw) || typeof count !== 'number' || !Number.isInteger(count) || count < 0) return generic;
  const voids = raw.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  // The hub lists up to 40 of `count`, so a blocked close always lists at least one.
  if (voids.length === 0) return generic;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const items = voids.map((v) => [text(v['identifier']), text(v['item']), text(v['requester_name'])].join(' · '));
  if (count > voids.length) items.push(fill(t('admin_stock.errors.DAY_CLOSE_BLOCKED_more'), { n: String(count - voids.length) }));
  return { tone: 'danger', text: fill(t('admin_stock.errors.DAY_CLOSE_BLOCKED'), { count: String(count) }), items };
}

function errorMessage(error: HubError): Message {
  if (error.kind === 'network') return { tone: 'danger', text: t('admin_stock.errors.network') };
  if (error.kind === 'signed_out') return { tone: 'danger', text: t('errors.ADMIN_SESSION_REQUIRED') };
  if (outsideScope(error)) return { tone: 'danger', text: t('admin_stock.errors.outside_scope') };
  if (error.code === 'DAY_CLOSE_BLOCKED') return dayCloseBlocked(error.details);
  return { tone: 'danger', text: t(adminErrorKey(error.code)) };
}

// 01b §4.4 row 13: a counter can't start the day, so a refused save or Add asks for someone who can.
function notStarted(): Message {
  return { tone: 'warn', text: t('admin_stock.counter.not_started') };
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

// Avatar initials: the first letters of two words, or the first two letters of one ("Imran" → "IM").
function avatarText(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== '');
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => [...w][0] ?? '') : [...(words[0] ?? '')].slice(0, 2);
  return letters.join('').toUpperCase();
}

// S54 f: from tablet width the page sits in the 00-S20 hub admin shell (00 M86); on a phone it has only
// its own app bar. Pulse: the shell fits the screen and only the content region scrolls (hand-off PROMPT).
function Shell({ branchId, children }: { branchId: string | null; children: ReactNode }) {
  const phone = usePhone();
  if (phone) return <div className="pos-page pos-page--stock">{children}</div>;
  return (
    <div className="pos-page pos-page--fit">
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
        <div className="pos-shell__main">{children}</div>
      </div>
    </div>
  );
}

function StockView({ api, onSignedOut }: { api: HubAdmin; onSignedOut: () => void }) {
  const [status, setStatus] = useState<HubConfigStatus | null>(null);
  // 01c §6.21: the stock item rows and the availability rows per menu item.
  const [stockMeta, setStockMeta] = useState<readonly HubStockRowMeta[]>([]);
  const [stock, setStock] = useState<readonly HubStockRow[]>([]);
  const [meta, setMeta] = useState<readonly HubStockItemMeta[]>([]);
  const [items, setItems] = useState<readonly HubStockItem[]>([]);
  const [clock, setClock] = useState<HubClock | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [day, setDay] = useState<BusinessDay | null>(null);
  const [stale, setStale] = useState(false);
  const [staleAfterHours, setStaleAfterHours] = useState(16);
  const [minGapHours, setMinGapHours] = useState(4);
  // 01b §4.4 row 13 (D-6): `my_stations` hides Start day, Close day and the stale-day prompt.
  const [counter, setCounter] = useState(false);
  // "Keep it open" hides the stale prompt until the page reloads.
  const [keepOpen, setKeepOpen] = useState(false);
  const [dayBusy, setDayBusy] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  // S45: the per-row Add field values (per stock item), kept across refreshes like the counts.
  const [adds, setAdds] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [offline, setOffline] = useState(false);
  // Every stock row whose Count the user touched (edited, even back to the same number, or confirmed).
  const [drafts, setDrafts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // B17: per-row feedback: added (per stock item), a switch that failed (per menu item).
  const [notes, setNotes] = useState<ReadonlyMap<string, RowNote>>(new Map());
  const [itemNotes, setItemNotes] = useState<ReadonlyMap<string, RowNote>>(new Map());
  const [savedLine, setSavedLine] = useState<string | null>(null);
  // The stock query refused (403, 409, 500): shown until the next good answer.
  const [queryError, setQueryError] = useState<Message | null>(null);
  // S55: counts brought back after an idle sign-out, and rows saved by someone else since.
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<{ n: number; time: string; changed: string[] } | null>(null);
  const [askSignOut, setAskSignOut] = useState(false);
  // 01a-D10 from the More menu.
  const [askCloseDay, setAskCloseDay] = useState(false);
  // 01c-B02 (brief Q17): a save or Add refused 404 STOCK_ITEM_NOT_FOUND; nothing was saved. Reload is the one
  // primary and Save waits for it.
  const [changedInSetup, setChangedInSetup] = useState(false);
  const phone = usePhone();
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const versions = useRef<StockVersions | undefined>(undefined);
  const noDayBanner = useRef<HTMLDivElement>(null);
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
    setCounter(answer.manage_stock_scope === 'my_stations');
    versions.current = { meta_version: answer.meta_version, stock_version: answer.stock_version };
    // §6.19: an unchanged answer carries no item data; the rows stay.
    if (answer.stock_items_meta !== null) setStockMeta(answer.stock_items_meta);
    if (answer.stock !== null) setStock(answer.stock);
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
  // 01c §3.5.4, §8: one row per stock item, its drawers under it; the other menu items as Selling rows.
  const page = pageRows(stockMeta, stock, meta, items);
  const rows = page.stock;
  const rowOf = (stockItemId: string) => rows.find((r) => r.meta.stock_item_id === stockItemId);
  const openDay = day !== null && day.closed_at === null ? day.opened_at : null;
  const branchId = status?.branch_id ?? null;
  const staffId = api.staffId();
  const key = branchId !== null && openDay !== null && staffId !== null ? draftKey(branchId, openDay, staffId) : null;

  // Review N-6: the no-day banner already says it, so point at it instead of a second warning.
  const askForStarter = () => {
    const banner = noDayBanner.current;
    if (banner === null) {
      setMessage(notStarted());
      return;
    }
    banner.scrollIntoView?.({ block: 'center' });
    banner.focus();
  };

  // S55: once the rows, the day and the branch are known, bring back this person's kept counts.
  useEffect(() => {
    if (restoredOnce.current || branchId === null || openDay === null || staffId === null || rows.length === 0 || clock === null) return;
    restoredOnce.current = true;
    const draft = loadDraft(localStore(), branchId, openDay, staffId);
    if (draft === null) return;
    const { touched, changed } = restoreDraft(draft, rows);
    for (const entry of draft.entries) if (touched.has(entry.stock_item_id)) bases.current.set(entry.stock_item_id, entry.base_set_at);
    if (touched.size > 0) {
      setDrafts((d) => new Map([...touched, ...d]));
      setRestored(new Set(touched.keys()));
    }
    if (touched.size > 0 || changed.length > 0) {
      setKept({
        n: touched.size,
        time: hubTimeText(draft.saved_at, clock.utcOffsetMs),
        changed: changed.map((c) => `${c.name} (${formatQuantity(c.now, rowOf(c.stock_item_id)?.meta.stock_unit ?? 'piece')})`),
      });
    }
  });

  // S55: every edit while a day is open is written to this tablet; an empty draft is removed.
  useEffect(() => {
    if (key === null || clock === null) return;
    const entries = [...drafts].flatMap(([id, value]) => {
      const row = rowOf(id);
      return value === null || row === undefined
        ? []
        : [{ stock_item_id: id, on_hand: value, unit: row.meta.stock_unit, base_set_at: bases.current.get(id) ?? row.stock.set_at }];
    });
    saveDraft(localStore(), key, { saved_at: clock.nowMs(), entries });
    // rows and clock are read, not watched: only an edit (or a new day or person) writes.
  }, [drafts, key]);

  const edit = (stockItemId: string, value: number | null) => {
    if (!bases.current.has(stockItemId)) bases.current.set(stockItemId, rowOf(stockItemId)?.stock.set_at ?? null);
    setSavedLine(null);
    setDrafts((d) => new Map(d).set(stockItemId, value));
  };
  const confirm = (stockItemId: string) => {
    const row = rowOf(stockItemId);
    if (row !== undefined) edit(stockItemId, shownOnHand(row));
  };

  // S56: rows carried over from the last day, still unconfirmed.
  const carried = rows.filter(
    (r) => r.meta.carries_over && startedAt !== null && shownOnHand(r) !== null && r.stock.set_at !== null && r.stock.set_at < startedAt,
  );
  const carriedOpen = carried.filter((r) => !drafts.has(r.meta.stock_item_id));

  const save = async (override?: ReadonlyMap<string, number | null>) => {
    // 01c-B02: nothing saves while the "stock item changed in setup" banner waits for Reload.
    if (changedInSetup) return;
    const current = override ?? drafts;
    // Row order; a cleared input has no number to send (01c §6.18: by stock item).
    const entries = rows.flatMap(({ meta: m }) => {
      const value = current.get(m.stock_item_id);
      return value !== undefined && value !== null ? [{ stock_item_id: m.stock_item_id, on_hand: value }] : [];
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
          if (next.get(e.stock_item_id) === e.on_hand) {
            next.delete(e.stock_item_id);
            bases.current.delete(e.stock_item_id);
          }
        }
        return next;
      });
      setRestored((r) => new Set([...r].filter((id) => !saved.some((e) => e.stock_item_id === id))));
    }
    if (failure !== null) {
      if (failure.kind === 'signed_out') onSignedOut();
      else if (dayNotOpen(failure)) {
        if (counter) askForStarter();
        else setBlocked({ kind: 'save' });
      } else if (outsideScope(failure)) {
        setMessage(errorMessage(failure));
        await refresh();
      } else if (failure.kind === 'api' && failure.code === 'STOCK_ITEM_NOT_FOUND') {
        // 01c §6.18: the stock item is no longer counted here; nothing was written for any entry. The rows
        // are read again at once; the banner stays until Reload (01c-B02).
        setChangedInSetup(true);
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
      if (!bases.current.has(row.meta.stock_item_id)) bases.current.set(row.meta.stock_item_id, row.stock.set_at);
      next.set(row.meta.stock_item_id, shownOnHand(row));
    }
    setDrafts(next);
    await save(next);
  };

  const add = async (stockItemId: string, given?: number) => {
    const quantity = given ?? adds.get(stockItemId);
    if (quantity === undefined || quantity === null || quantity === 0) return;
    const pending = pendingAdds.current.get(stockItemId);
    const commandId = pending?.quantity === quantity ? pending.commandId : newUlid();
    pendingAdds.current.set(stockItemId, { commandId, quantity });
    setMessage(null);
    setNotes((n) => new Map(n).set(stockItemId, { tone: 'info', text: t('admin_stock.adding') }));
    const answer = await api.addPrecookedStock({ entries: [{ stock_item_id: stockItemId, quantity }] }, commandId);
    setNotes((n) => {
      const next = new Map(n);
      next.delete(stockItemId);
      return next;
    });
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else if (dayNotOpen(answer.error)) {
        if (counter) askForStarter();
        else setBlocked({ kind: 'add', stockItemId, quantity });
      } else if (answer.error.kind === 'api' && answer.error.code === 'STOCK_ITEM_NOT_FOUND') {
        setChangedInSetup(true);
        await refresh();
      } else {
        setMessage(errorMessage(answer.error));
        if (outsideScope(answer.error)) await refresh();
      }
      return;
    }
    pendingAdds.current.delete(stockItemId);
    const unit = rowOf(stockItemId)?.meta.stock_unit ?? 'piece';
    setNotes((n) => new Map(n).set(stockItemId, { tone: 'ok', text: fill(t('admin_stock.added'), { n: formatQuantity(quantity, unit) }) }));
    setAdds((a) => {
      const next = new Map(a);
      if (next.get(stockItemId) === quantity) next.delete(stockItemId);
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
    else if (retry?.kind === 'add') await add(retry.stockItemId, retry.quantity);
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
        setItemNotes((n) =>
          new Map(n).set(itemId, { tone: 'danger', text: t(isAvailable ? 'admin_stock.switch_on_failed' : 'admin_stock.switch_off_failed') }),
        );
        if (answer.error.kind !== 'network') setMessage(errorMessage(answer.error));
      }
      return;
    }
    setItemNotes((n) => {
      const next = new Map(n);
      next.delete(itemId);
      return next;
    });
    await refresh();
  };

  // 01c-B02: Reload reads the rows again and lets Save go; the typed counts of the rows still here stay.
  const reloadAfterChange = async () => {
    setChangedInSetup(false);
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
  const countedToday = rows.filter((r) => !toCount(r, startedAt)).length;
  const name = api.adminName();

  const progress = rows.length === 0 ? 0 : countedToday / rows.length;
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
      <strong>{savedLine}</strong>
      {countedToday === rows.length && rows.length > 0 && <span>{t('admin_stock.all_counted')}</span>}
    </>
  ) : (
    <>
      <strong>{fill(t('admin_stock.counted_n'), { n: String(countedToday), m: String(rows.length) })}</strong>
      {!phone && <progress className="pos-progress" max={1} value={progress} aria-hidden="true" />}
    </>
  );
  // The bar's help line (01c-B02 "Count the pot once…"); the other states carry their own second line.
  const note = !offline && !(kept !== null && restored.size > 0) && savedLine === null;

  const canCloseDay = clock !== null && !counter && day !== null && day.closed_at === null;
  const signOutNow = () => (touched > 0 ? setAskSignOut(true) : void signOut('none'));
  const moreItems: MoreMenuItem[] = [
    ...(canCloseDay ? [{ label: t('admin_stock.day.close'), icon: 'archive' as const, danger: true, disabled: dayBusy, onSelect: () => setAskCloseDay(true) }] : []),
    ...(phone ? [{ label: t('admin_stock.sign_out'), icon: 'logout' as const, onSelect: signOutNow }] : []),
  ];
  const [whoBefore, whoAfter] = t('admin_stock.signed_in_as').split('{name}');

  // 01c-B02 (Q17): the 404 banner with Reload; on a tablet it stays under the app bar while the rows scroll.
  const changedBanner = changedInSetup && (
    <div className="pos-banner pos-banner--warn" role="status" data-changed-in-setup="">
      <Icon name="reload" />
      <p>
        {t('admin_stock.changed_in_setup')}
        <small>{t('admin_stock.nothing_saved')}</small>
      </p>
      <div className="pos-banner__action pos-row">
        <button type="button" className="pos-btn pos-btn--primary" onClick={() => void reloadAfterChange()}>
          <Icon name="reload" />
          {t('admin_stock.reload')}
        </button>
      </div>
    </div>
  );

  return (
    <Shell branchId={branchId}>
      <AppBar
        title={t('admin_stock.title')}
        phone={phone}
        after={
          <>
            {clock !== null && <DayChip day={day} clock={clock} staleAfterHours={staleAfterHours} />}
            {/* S54 e, §8.2 (B10): the one status line is a header chip in every state; More repeats it. */}
            {status !== null && <ConfigChip status={status} clock={clock} />}
          </>
        }
      >
        {name !== null && (
          <span className="pos-who">
            <span className="pos-avatar" aria-hidden="true">
              {avatarText(name)}
            </span>
            {whoBefore !== undefined && whoBefore !== '' && <span className="pos-vh">{whoBefore}</span>}
            {name}
            {whoAfter !== undefined && whoAfter !== '' && <span className="pos-vh">{whoAfter}</span>}
          </span>
        )}
        {!phone && (
          <button type="button" className="pos-btn" onClick={signOutNow}>
            {t('admin_stock.sign_out')}
          </button>
        )}
        {(status !== null || moreItems.length > 0) && (
          <MoreMenu
            label={t('admin_stock.more')}
            head={status === null ? undefined : <MenuStatus status={status} clock={clock} />}
            items={moreItems}
          />
        )}
      </AppBar>
      {!phone && changedBanner && <div className="pos-banners">{changedBanner}</div>}
      <main className="pos-content" data-view="stock">
        {phone && changedBanner}
        {counter && (
          <div className="pos-explain" data-counter-note="">
            <Icon name="clipboard" />
            <span>{t('admin_stock.counter.note')}</span>
          </div>
        )}
        {/* 01b §4.4 rows 11, 13: no Start day for a counter, but the rows and the Selling switch stay (01a §6.18 needs no day). */}
        {counter && noDay && (
          <div ref={noDayBanner} tabIndex={-1} data-not-started="">
            <Banner tone="warn" text={t('admin_stock.counter.not_started')} />
          </div>
        )}
        {status !== null && <ConfigProblem status={status} />}
        {offline && (
          <div className="pos-banner pos-banner--warn pos-banner--pulse" role="status">
            <Icon name="sync" />
            <p>
              {t('admin_stock.reconnecting')}
              <small>{t('admin_stock.reconnecting_body')}</small>
            </p>
          </div>
        )}
        {queryError !== null && <Banner tone={queryError.tone} text={queryError.text} />}
        {message !== null && <Banner tone={message.tone} text={message.text} detail={message.detail} items={message.items} />}
        {kept !== null && (
          <div className="pos-banner pos-banner--ok" role="status" data-kept="">
            <Icon name="check" />
            <p>
              {fill(t('admin_stock.kept.title'), { n: String(kept.n), time: kept.time })}
              <small>
                {t('admin_stock.kept.body')}
                {kept.changed.length > 0 && ` ${fill(t('admin_stock.kept.changed'), { items: kept.changed.join(', ') })}`}
              </small>
            </p>
            <div className="pos-banner__action pos-row">
              <button type="button" className="pos-btn" onClick={discardKept}>
                {t('admin_stock.kept.discard')}
              </button>
            </div>
          </div>
        )}
        {clock !== null && !counter && stale && !keepOpen && day !== null && (
          <StalePrompt
            openedAt={day.opened_at}
            clock={clock}
            busy={dayBusy}
            onCloseAndStart={() => void closeAndStart()}
            onKeep={() => setKeepOpen(true)}
          />
        )}
        {clock !== null && !counter && noDay && <StartDay place="rows" busy={dayBusy} onStart={() => void startDay()} />}
        {blocked !== null && (
          <StartDay place="retry" busy={dayBusy} primary waiting={touched} onStart={() => void startDay()} />
        )}
        {!noDay && carriedOpen.length > 0 && (
          <section className="pos-callout" data-carry="">
            <div className="pos-callout__icon">
              <Icon name="check" />
            </div>
            <div className="pos-callout__text">
              <h2>
                {carriedOpen.length === 1
                  ? t('admin_stock.carry.title_one')
                  : fill(t('admin_stock.carry.title'), { n: String(carriedOpen.length) })}
              </h2>
              <p>{t('admin_stock.carry.body')}</p>
            </div>
            <div className="pos-callout__actions">
              <BusyButton busy={saving} disabled={changedInSetup} onClick={() => void confirmAll()}>
                <Icon name="check" />
                {fill(t('admin_stock.carry.all'), { n: String(carriedOpen.length) })}
              </BusyButton>
            </div>
          </section>
        )}
        {clock !== null && (
          <StockTable
            rows={rows}
            items={page.items}
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
            itemNotes={itemNotes}
            restored={restored}
            focusId={focus}
            alerts={<AlertBar rows={rows} onPick={(id) => setFocus({ id })} />}
          />
        )}
      </main>
      <footer className="pos-actionbar">
        <div className="pos-actionbar__info">{info}</div>
        {note && !phone && <span className="pos-note">{t('admin_stock.bar_note')}</span>}
        <div className="pos-actionbar__end">
          {kept !== null && restored.size > 0 && (
            <button type="button" className="pos-btn" onClick={discardKept}>
              {t('admin_stock.kept.discard')}
            </button>
          )}
          {blocked === null && (
            <span data-save="">
              <BusyButton primary={!noDay && !changedInSetup} disabled={changedInSetup} size="lg" busy={saving} onClick={() => void save()}>
                {touched === 0
                  ? t('admin_stock.save')
                  : fill(t(touched === 1 ? 'admin_stock.save_one' : 'admin_stock.save_n'), { n: String(touched) })}
              </BusyButton>
            </span>
          )}
        </div>
      </footer>
      {askCloseDay && day !== null && clock !== null && (
        <CloseDayDialog
          day={day}
          clock={clock}
          keepsOvernight={rows.filter((r) => r.meta.carries_over).map((r) => r.meta.name)}
          switchedOff={page.all.filter((r) => !r.item.is_available).map((r) => r.meta.name)}
          onCancel={() => setAskCloseDay(false)}
          busy={dayBusy}
          onClose={async () => {
            await closeDay();
            setAskCloseDay(false);
          }}
        />
      )}
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
              <button type="button" className="pos-btn pos-btn--primary" disabled={changedInSetup} onClick={() => void signOut('save')}>
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
