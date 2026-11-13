import { Icon } from '../../../components/Icon';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { PrinterStatus, TestPrintResult } from './api';

// 03c §6.4; 03c-D03 (frame PrinterTest): the test print result, shown under the card's Test print button, one at a
// time. `{ printed, status, error }`: printed + clean = status works (and the printer's suspect tickets are being
// reprinted, §3.5); printed + unknown = no status; printed + a bad status = warn; not printed = busy (warn) or failed.

export type TestState =
  | { kind: 'busy' }
  | { kind: 'done'; result: TestPrintResult; suspect: number }
  | { kind: 'refused'; error: HubError };

export const STATUS_KEY: Record<PrinterStatus, MessageKey> = {
  clean: 'printers.status.clean',
  paper_out: 'printers.status.paper_out',
  offline: 'printers.status.offline',
  unknown: 'printers.status.unknown',
};

// The hub's error codes (apps/hub/src/print/transport/lan.ts SendError, print/routes.ts, print/worker.ts): a code,
// often with a detail after ':' (`connect_failed:ECONNREFUSED`, `write_failed:child_exit`); only the code is read.
const ERROR_KEY: Record<string, MessageKey> = {
  connect_failed: 'printers.error.connect',
  connect_timeout: 'printers.error.connect',
  write_timeout: 'printers.error.write_timeout',
  write_failed: 'printers.error.write_failed',
  busy: 'printers.error.busy',
};

export function printerErrorText(error: string): string {
  return t(ERROR_KEY[error.split(':')[0]!] ?? 'printers.error.write_failed');
}

/** "Out of paper" → "out of paper" inside a sentence (a no-op for Urdu). */
function inSentence(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

type View = { tone: 'busy' | 'ok' | 'warn' | 'danger'; text: string; detail?: string };

export function testView(state: TestState): View {
  if (state.kind === 'busy') return { tone: 'busy', text: t('printers.test_busy'), detail: t('printers.test_busy_detail') };
  if (state.kind === 'refused') return { tone: 'danger', text: errorText(state.error) };
  const { printed, status, error } = state.result;
  if (printed) {
    if (status === 'clean') {
      return state.suspect > 0
        ? { tone: 'ok', text: t('printers.test_ok'), detail: fill(t('printers.test_recovered'), { n: String(state.suspect) }) }
        : { tone: 'ok', text: t('printers.test_ok') };
    }
    if (status === 'unknown') return { tone: 'ok', text: t('printers.test_no_status') };
    return { tone: 'warn', text: fill(t('printers.test_bad_status'), { status: inSentence(t(STATUS_KEY[status])) }) };
  }
  // frame PrinterTest: the test's own busy line (the queue's head error keeps printers.error.busy)
  if (error === 'busy') return { tone: 'warn', text: t('printers.test_in_use') };
  return { tone: 'danger', text: fill(t('printers.test_failed'), { error: printerErrorText(error ?? 'write_failed') }) };
}

const ICON = { busy: 'sync', ok: 'check', warn: 'clock', danger: 'alert' } as const;

export function TestPrint({ state }: { state: TestState | null }) {
  if (state === null) return null;
  const view = testView(state);
  return (
    <div className={`tres tres--${view.tone}`} role="status">
      <Icon name={ICON[view.tone]} />
      <div>
        <b>{view.text}</b>
        {view.detail !== undefined && <small>{view.detail}</small>}
      </div>
    </div>
  );
}
