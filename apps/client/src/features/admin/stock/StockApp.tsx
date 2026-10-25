import type { HubConfigStatus, HubStockItem, HubStockItemMeta } from '@pos/events';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubAdmin, HubError, StockVersions } from '../../../api/hub-admin';
import { createHubClock, type HubClock } from '../../../app/hub-clock';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { adminErrorKey } from '../../../i18n/en';
import { AdminLogin } from './AdminLogin';
import type { StockRow } from './badges';
import { AlertBar } from './AlertBar';
import { ConfigStatus } from './ConfigStatus';
import { shownOnHand, StockTable } from './StockTable';

// §8.2: stock query and config status on open and every 15 s while the page is visible.
export const REFRESH_MS = 15_000;

// §8.2: no admin session → the roster and PIN pad; with one → the stock view. A `signed_out` answer
// (the hub ended the session) goes back to the roster.
export function StockApp({ api }: { api: HubAdmin }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  const signedOut = useCallback(() => setSignedIn(false), []);

  if (!signedIn) return <AdminLogin api={api} onLoggedIn={() => setSignedIn(true)} />;
  return <StockView api={api} onSignedOut={signedOut} />;
}

type Message = { tone: 'ok' | 'warn' | 'danger'; text: string };

function errorMessage(error: HubError): Message {
  if (error.kind === 'network') return { tone: 'danger', text: t('admin_stock.errors.network') };
  if (error.kind === 'signed_out') return { tone: 'danger', text: t('errors.ADMIN_SESSION_REQUIRED') };
  return { tone: 'danger', text: t(adminErrorKey(error.code)) };
}

function StockView({ api, onSignedOut }: { api: HubAdmin; onSignedOut: () => void }) {
  const [status, setStatus] = useState<HubConfigStatus | null>(null);
  const [meta, setMeta] = useState<readonly HubStockItemMeta[]>([]);
  const [items, setItems] = useState<readonly HubStockItem[]>([]);
  const [clock, setClock] = useState<HubClock | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  // Every row whose On hand the user touched (edited, even back to the same number, or confirmed).
  const [drafts, setDrafts] = useState<ReadonlyMap<string, number | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const versions = useRef<StockVersions | undefined>(undefined);
  // D32: the save's command_id, kept for retries of the same entries.
  const pendingSave = useRef<{ commandId: string; key: string } | null>(null);

  const refresh = useCallback(async () => {
    // D7: config-status is read on open, before any command, and gives the envelope's ids.
    const [config, stock] = await Promise.all([api.configStatus(), api.stock(versions.current)]);
    if ((!config.ok && config.error.kind === 'signed_out') || (!stock.ok && stock.error.kind === 'signed_out')) {
      onSignedOut();
      return;
    }
    if (config.ok) setStatus(config.data);
    if (!stock.ok) {
      // The hub is unreachable: keep the rows and what was typed.
      if (stock.error.kind === 'network') setOffline(true);
      return;
    }
    const answer = stock.data;
    setOffline(false);
    setClock(createHubClock(answer.hub_time));
    setStartedAt(answer.business_day_started_at);
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

  const byId = new Map(items.map((i) => [i.item_id, i]));
  const rows: StockRow[] = meta.flatMap((m) => {
    const item = byId.get(m.item_id);
    return item === undefined ? [] : [{ meta: m, item }];
  });

  const edit = (itemId: string, value: number | null) => setDrafts((d) => new Map(d).set(itemId, value));
  const confirm = (itemId: string) => {
    const row = rows.find((r) => r.meta.item_id === itemId);
    if (row !== undefined) edit(itemId, shownOnHand(row));
  };

  const save = async () => {
    // Config order; a cleared input has no number to send.
    const entries = rows.flatMap(({ meta: m }) => {
      const value = drafts.get(m.item_id);
      return m.is_stock_tracked && value !== undefined && value !== null ? [{ item_id: m.item_id, on_hand: value }] : [];
    });
    if (entries.length === 0) {
      setMessage({ tone: 'warn', text: t('admin_stock.nothing_to_save') });
      return;
    }
    const key = JSON.stringify(entries);
    if (pendingSave.current?.key !== key) pendingSave.current = { commandId: newUlid(), key };
    setSaving(true);
    setMessage(null);
    const answer = await api.setPrecookedStock({ entries }, pendingSave.current.commandId);
    setSaving(false);
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else setMessage(errorMessage(answer.error));
      return;
    }
    pendingSave.current = null;
    setDrafts((d) => {
      const next = new Map(d);
      for (const e of entries) if (next.get(e.item_id) === e.on_hand) next.delete(e.item_id);
      return next;
    });
    setMessage({ tone: 'ok', text: t('admin_stock.saved') });
    await refresh();
  };

  const toggle = async (itemId: string, isAvailable: boolean) => {
    setMessage(null);
    const answer = await api.setItemAvailability({ item_id: itemId, is_available: isAvailable }, newUlid());
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else setMessage(errorMessage(answer.error));
      return;
    }
    await refresh();
  };

  return (
    <main className="pos-screen pos-stack" data-view="stock">
      <h1 className="title">{t('admin_stock.title')}</h1>
      {status !== null && <ConfigStatus status={status} clock={clock} />}
      {offline && <Banner tone="info" text={t('admin_stock.reconnecting')} />}
      <AlertBar rows={rows} />
      {clock !== null && (
        <StockTable
          rows={rows}
          startedAt={startedAt}
          clock={clock}
          drafts={drafts}
          onEdit={edit}
          onConfirm={confirm}
          onToggle={(id, next) => void toggle(id, next)}
        />
      )}
      <BusyButton primary busy={saving} onClick={() => void save()}>
        {t('admin_stock.save')}
      </BusyButton>
      {message !== null && <Banner tone={message.tone} text={message.text} />}
    </main>
  );
}
