import { useCallback, useEffect, useRef, useState } from 'react';
import { usePhone } from '../../../app/phone';
import { AppBar } from '../../../components/AppBar';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { AdminShell, AdminSignIn, errorText, Toast, useToast } from '../kitchen-screens/KitchenScreens';
import { Glyph } from '../kitchen-screens/StationRow';
import type { ConfigPrinter, OutputMode, PrintConfig, PrintersApi, PrintQueue, PrinterStatus, QueuePrinter, StationOutput } from './api';
import { ArchiveDialog } from './ArchiveDialog';
import { PrinterDialog } from './PrinterDialog';
import { STATUS_KEY, TestPrint, printerErrorText, type TestState } from './TestPrint';

// 03c §3.2, §6.2, §6.4, §6.6, §6.7, §8 (task A2; frames 03c-S01 Printers, PrintersPhone, PrintersUrdu, F01
// PrintersNone, D01–D03): the hub admin "Printers" page at /admin/printers/ (Q-43). Q-54: no timer — print-config and
// print-queue are read together on open, on Reload and once after each own command (save, archive, test).

export const OUTPUTS_SECTION_ID = 'station-outputs';

const MODE_KEY = {
  screen: 'outputs.mode.screen',
  fallback: 'outputs.mode.fallback',
  both: 'outputs.mode.both',
  printer: 'outputs.mode.printer',
} as const;

/** 03c §3.2 read back: `screen` with a printer = "screen, paper if the screen is off". */
export function outputOption(o: { mode: OutputMode; printer_id: string | null }): keyof typeof MODE_KEY {
  return o.mode === 'screen' && o.printer_id !== null ? 'fallback' : o.mode;
}

function inSentence(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function connectionText(p: ConfigPrinter): string {
  // LAN / USB, the address and the paper size stay Latin and LTR (handoff PROMPT).
  return `${p.connection.toUpperCase()} · ${p.address} · ${fill(t('printers.paper_mm'), { n: String(p.paper_width_mm) })}`;
}

const STATUS_TONE: Record<PrinterStatus, 'ok' | 'danger' | undefined> = { clean: 'ok', paper_out: 'danger', offline: 'danger', unknown: undefined };

function PrinterCard({
  printer,
  live,
  users,
  test,
  readOnly,
  onTest,
  onEdit,
  onArchive,
}: {
  printer: ConfigPrinter;
  live: QueuePrinter | undefined;
  users: readonly StationOutput[];
  test: TestState | null;
  /** 00 M89: without manage-devices the card has no actions */
  readOnly: boolean;
  onTest: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const archived = printer.archived_at !== null;
  const status: PrinterStatus = live?.status ?? printer.last_status ?? 'unknown';
  const bad = !archived && (status === 'paper_out' || status === 'offline');
  const usedBy = users.length === 0 ? t('printers.used_by_nothing') : users.map((u) => `${u.name ?? u.station_id} (${inSentence(t(MODE_KEY[outputOption(u)]))})`).join(', ');
  const [usedBefore, usedAfter] = t('printers.used_by').split('{stations}');
  return (
    <article className={`pos-card pr${archived ? ' pr--off' : bad ? ' pr--bad' : ''}`}>
      <div className="pr__h">
        <span className="pr__ic">
          <Glyph name="printer" />
        </span>
        <div>
          <strong>{printer.name}</strong>
          <span className="mono">{connectionText(printer)}</span>
        </div>
        {archived ? <Chip icon="archive">{t('printers.archived')}</Chip> : <Chip tone={STATUS_TONE[status]}>{t(STATUS_KEY[status])}</Chip>}
      </div>
      <div className="pr__facts">
        {!archived && printer.supports_status === 0 && <span>{t('printers.no_status')}</span>}
        {live !== undefined && live.waiting > 0 && <span>{fill(t('printers.waiting'), { n: String(live.waiting) })}</span>}
        {live !== undefined && live.suspect > 0 && <span>{fill(t('printers.suspect'), { n: String(live.suspect) })}</span>}
        {!archived && live !== undefined && live.waiting > 0 && live.head_error !== null && live.head_error !== 'manager' && <span>{printerErrorText(live.head_error)}</span>}
      </div>
      <div className="pr__facts">
        <span>
          {usedBefore}
          <b>{usedBy}</b>
          {usedAfter}
        </span>
      </div>
      {!archived && printer.connection === 'usb' && <Banner tone="info" icon="info" text={t('printers.usb_note')} />}
      {!archived && !readOnly && (
        <>
          <TestPrint state={test} />
          <div className="pr__acts">
            <button type="button" className={`pos-btn${test?.kind === 'busy' ? ' is-busy' : ''}`} disabled={test?.kind === 'busy'} onClick={onTest}>
              <Glyph name="printer" />
              {t('printers.test')}
            </button>
            <button type="button" className="pos-btn" onClick={onEdit}>
              <Icon name="edit" />
              {t('printers.edit')}
            </button>
            <MoreMenu
              label={fill(t('common.more_for'), { name: printer.name })}
              up
              items={[{ label: t('printers.archive'), icon: 'archive', danger: true, onSelect: onArchive }]}
            />
          </div>
        </>
      )}
    </article>
  );
}

export function PrintersApp({ api }: { api: PrintersApi }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  if (!signedIn) {
    return <AdminSignIn api={api} title={t('printers.title')} chip="printers.sign_in" noAdmins="printers.no_admins" onLoggedIn={() => setSignedIn(true)} />;
  }
  return <Printers api={api} onSignedOut={() => setSignedIn(false)} />;
}

type Open = { kind: 'add' } | { kind: 'edit'; printer: ConfigPrinter } | { kind: 'archive'; printer: ConfigPrinter } | null;

function Printers({ api, onSignedOut }: { api: PrintersApi; onSignedOut: () => void }) {
  const phone = usePhone();
  const [config, setConfig] = useState<PrintConfig | null>(null);
  const [queue, setQueue] = useState<PrintQueue | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [tests, setTests] = useState<ReadonlyMap<string, TestState>>(new Map());
  // 00 M89: the stored permissions say no manage-devices, or a read answered 403 PERMISSION_DENIED (lost mid-session).
  const [readOnly, setReadOnly] = useState(() => api.permission('manage-devices') === false);
  const [toast, showToast] = useToast();
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const [c, q] = await Promise.all([api.printConfig(), api.printQueue()]);
    if (request !== latest.current) return;
    if ((!c.ok && c.error.kind === 'signed_out') || (!q.ok && q.error.kind === 'signed_out')) {
      onSignedOut();
      return;
    }
    const failed = !c.ok ? c.error : !q.ok ? q.error : null;
    setProblem(failed === null ? null : errorText(failed));
    if (failed?.kind === 'api' && failed.code === 'PERMISSION_DENIED') setReadOnly(true);
    if (c.ok) setConfig(c.data);
    if (q.ok) setQueue(q.data);
  }, [api, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  // A command answer → null when it went through; a signed-out answer leaves the page.
  const settle = (answer: { ok: true } | { ok: false; error: HubError }): HubError | null => {
    void load();
    if (answer.ok) return null;
    if (answer.error.kind === 'signed_out') onSignedOut();
    return answer.error;
  };

  // Edit and Archive start from a fresh print-config read (one read, no timer): the hub has no version on SavePrinter,
  // so a stale card must not bring back a printer another admin archived or overwrite their edit.
  const openFresh = async (printerId: string, kind: 'edit' | 'archive') => {
    const answer = await api.printConfig();
    if (!answer.ok) {
      if (answer.error.kind === 'signed_out') onSignedOut();
      else showToast(errorText(answer.error));
      return;
    }
    setConfig(answer.data);
    const fresh = answer.data.printers.find((p) => p.printer_id === printerId);
    if (fresh === undefined || fresh.archived_at !== null) {
      showToast(t('errors.PRINTER_NOT_FOUND'));
      return;
    }
    setOpen({ kind, printer: fresh });
  };

  const runTest = async (printer: ConfigPrinter) => {
    const suspect = queue?.printers.find((p) => p.printer_id === printer.printer_id)?.suspect ?? 0;
    setTests((m) => new Map(m).set(printer.printer_id, { kind: 'busy' }));
    const answer = await api.testPrint(printer.printer_id);
    const state: TestState = answer.ok ? { kind: 'done', result: answer.data, suspect } : { kind: 'refused', error: answer.error };
    setTests((m) => new Map(m).set(printer.printer_id, state));
    settle(answer);
  };

  const signOut = () => {
    void api.logout().then(onSignedOut);
  };

  const outputsOf = (printerId: string) => (config?.station_outputs ?? []).filter((o) => !o.archived && o.printer_id === printerId);
  const stationName = (stationId: string) => config?.station_outputs.find((o) => o.station_id === stationId)?.name ?? stationId;
  const live = (printerId: string) => queue?.printers.find((p) => p.printer_id === printerId);
  const statusOf = (p: ConfigPrinter): PrinterStatus => live(p.printer_id)?.status ?? p.last_status ?? 'unknown';
  // Phone: problems first (frame PrintersPhone).
  const printers =
    config === null
      ? []
      : phone
        ? [...config.printers].sort((a, b) => Number(['paper_out', 'offline'].includes(statusOf(b))) - Number(['paper_out', 'offline'].includes(statusOf(a))))
        : config.printers;

  return (
    <AdminShell current="printers" adminName={api.adminName()} onSignOut={signOut}>
      <AppBar title={t('printers.title')} phone={phone}>
        <button type="button" className="pos-btn" onClick={() => void load()}>
          <Icon name="reload" />
          {t('admin_stock.reload')}
        </button>
        {!readOnly && config !== null && config.printers.length > 0 && (
          <button type="button" className="pos-btn pos-btn--primary" onClick={() => setOpen({ kind: 'add' })}>
            <Icon name="plus" />
            {t('printers.add')}
          </button>
        )}
      </AppBar>
      {problem !== null && (
        <div className="pos-banners">
          <Banner tone="danger" text={problem} />
        </div>
      )}
      <main className="pos-content">
        {config === null ? (
          problem === null && <Skeleton lines={4} />
        ) : config.printers.length === 0 ? (
          <div className="pos-card ad-empty">
            <Glyph name="printer" />
            <h2>{t('printers.none_title')}</h2>
            <p>{t('admin.pr.none_hint')}</p>
            {!readOnly && (
              <button type="button" className="pos-btn" onClick={() => setOpen({ kind: 'add' })}>
                <Icon name="plus" />
                {t('printers.add')}
              </button>
            )}
          </div>
        ) : (
          <section className="ad-stack">
            <div className="ad-sec__h">
              <div>
                <h2>{t('printers.title')}</h2>
                <p>{t('printers.section_help')}</p>
              </div>
            </div>
            <div className={phone ? 'ad-stack' : 'ad-grid2'}>
              {printers.map((p) => (
                <PrinterCard
                  key={p.printer_id}
                  printer={p}
                  live={live(p.printer_id)}
                  users={outputsOf(p.printer_id)}
                  test={tests.get(p.printer_id) ?? null}
                  readOnly={readOnly}
                  onTest={() => void runTest(p)}
                  onEdit={() => void openFresh(p.printer_id, 'edit')}
                  onArchive={() => void openFresh(p.printer_id, 'archive')}
                />
              ))}
            </div>
          </section>
        )}
      </main>
      {(open?.kind === 'add' || open?.kind === 'edit') && (
        <PrinterDialog
          printer={open.kind === 'edit' ? open.printer : null}
          save={async (payload, commandId) => settle(await api.savePrinter(payload, commandId))}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'archive' && (
        <ArchiveDialog
          printer={open.printer}
          stationName={stationName}
          archive={async (commandId) => {
            const p = open.printer;
            return settle(
              await api.savePrinter(
                { printer_id: p.printer_id, name: p.name, connection: p.connection, address: p.address, paper_width_mm: p.paper_width_mm, archived: true },
                commandId,
              ),
            );
          }}
          onClose={() => setOpen(null)}
          onGoOutputs={() => {
            setOpen(null);
            document.getElementById(OUTPUTS_SECTION_ID)?.scrollIntoView();
          }}
        />
      )}
      <Toast text={toast} />
    </AdminShell>
  );
}

