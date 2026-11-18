import type { AlertCard, AlertLinkTarget, AlertLock } from '@pos/events';
import type { HubError } from '../../api/hub-admin';
import { t, type MessageKey } from '../../i18n';
import { fill } from '../../i18n/en';
import { orderErrorKey } from '../staff/orders/view/LineActions';
import { consumeFocus, matchStaffRoute, type StaffFocus } from '../staff/shell/routes';
import { checkTarget, REQUEST_KINDS, type CheckDeps, type CheckResult } from './deeplink-check';
import { passOpenedText, passPlace } from '../pass/pass-place';
import { focusPlace } from './glow';
import { tableOf } from './ui';

// 01d v1.3 §3.13.2: the one tap rule of every staff-app surface that can be tapped (an Inbox card, a "For <name>"
// group card, a requests-to-answer row, a banner's Open, the call banner). Rule 1: no target → today's tap. Rule 2:
// the open check (§3.13.3), then navigate + scroll + glow + "Opened …", or the toast and stay. Rule 3: seen in every
// case. Rule 7: the banner hides as today (the store's open). Rules 4 (requests), 5 (notices) and 6 (unfinished work)
// are below.

/** What a tap needs of a row: any of AlertRow, RequestView, an inbox row. */
export interface TapRow {
  alert_id: string;
  kind: string;
  raised_at: number;
  state?: 'open' | 'closed' | undefined;
  lock: AlertLock;
  card?: AlertCard | undefined;
  target?: AlertLinkTarget | null | undefined;
  /** the signed-in view's answers (AD-23) */
  answers?: readonly string[] | null | undefined;
  /** a requests-to-answer row */
  can_answer?: boolean | undefined;
}

/** Rule 4: a request this viewer can answer (answers on the signed-in view, or can_answer on a requests row). */
export function canAnswer(row: TapRow): boolean {
  return row.can_answer === true || (row.answers?.length ?? 0) > 0;
}

/** Rule 5: the copy kinds 14–17 (all six notice kinds: the `:also` result is a request_result too). */
export const NOTICE_KINDS: ReadonlySet<string> = new Set(['request_result', 'approval_receipt', 'answered_on_requester_device', 'pin_use_failed']);

export interface TapDeps extends CheckDeps {
  /** rule 3 + 7: the store's open (seen here, the banner hides) and the batched MarkAlertsSeen; once per tap */
  seen(): void;
  /** rule 1: today's tap, the AnswerSheet / NoticeSheet over the current screen */
  openSheet(): void;
  navigate(href: string): void;
  toast(text: string): void;
  /** the glow once the place is on screen (default: `glowOnArrival`) */
  arrive?: (href: string, focus: StaffFocus, label: string) => void;
  /** false once this tap is stale: a newer tap, a sign-in or sign-out, or a route change happened during the check.
   *  A stale tap does nothing more (no navigation, no toast, no sheet). Default: always current. */
  isCurrent?: () => boolean;
  /** the row's state now (the live row, or a held alert_closed), re-read after the check (§3.13.3) */
  stateNow?: () => 'open' | 'closed' | undefined;
  /** rule 4 (B2): how long an answerable tap waits for the check before AnswerSheet opens anyway */
  checkTimeoutMs?: number;
  /** rule 6: where the tap came from; a banner's Open does not navigate while a page dialog is open */
  source?: 'banner' | 'list';
  /** rule 6: any element with aria-modal="true" on the page (default: a DOM query) */
  dialogOpen?: () => boolean;
}

/** Rule 4 (B2): the check's longest wait for a request the viewer can answer. The spec names no number; 3 s (review
 *  of #255). Past it the sheet opens over the current screen, as for a failed check. */
export const CHECK_TIMEOUT_MS = 3_000;

const TIMED_OUT = Symbol('timed out');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/** Rule 6 (M5): a real popup is open: the Send dialog, the PIN pad, the remove / void / comp / mark-served sheets,
 *  AnswerSheet, NoticeSheet. The route-level screens TableSheet and OrderView carry aria-modal too, but they are no
 *  popups (owner Q-A (a), 01d v1.3.2): they are marked `data-route-sheet`, and a banner deep-links from them. */
export const pageDialogOpen = (): boolean => document.querySelector('[aria-modal="true"]:not([data-route-sheet])') !== null;

export type TapOutcome = 'sheet' | 'navigated' | 'not_open' | 'cannot_check' | 'stale';

/** §3.13.4: how long the place may take to appear after the navigation (its screen's own reads). Not a timing assert:
 *  past it, the screen is shown with no glow and no toast. */
export const ARRIVAL_MS = 4_000;

/** Rule 2, "cannot check": the existing text of that error ("No connection to the hub", 02b's outside-scope text, …). */
export function checkErrorText(error: HubError): string {
  return error.kind === 'network' ? t('answer.error.offline') : t(orderErrorKey(error));
}

const OPENED: Record<StaffFocus['kind'], MessageKey> = {
  table: 'alerts.opened.table',
  order: 'alerts.opened.order',
  line: 'alerts.opened.line',
  late: 'alerts.opened.late',
  item: 'alerts.opened.zone_item',
  alert: 'alerts.opened.inbox',
};

/** §3.13.6 n4: "Opened <place>", with the table chip or the item name the screen shows. */
export function openedText(row: TapRow, focus: StaffFocus): string {
  const item = row.card?.details?.item ?? null;
  const table = tableOf(row);
  const name = (focus.kind === 'line' || focus.kind === 'item' ? (item ?? table) : focus.kind === 'alert' ? null : table) ?? '';
  return fill(t(OPENED[focus.kind]), { name }).trim();
}

const cssId = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

/** §3.13.5: the element that glows for a focus, in order of preference (the tile, else the sheet header). */
function findPlace(href: string, focus: StaffFocus, root: ParentNode): HTMLElement | null {
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  switch (focus.kind) {
    case 'table': {
      const route = matchStaffRoute(href, 'tablet');
      if (route.name !== 'table') return null;
      return q(`[data-table="${cssId(route.table_id)}"]`) ?? (route.seating_id === null ? null : q(`[data-seating="${cssId(route.seating_id)}"]`));
    }
    case 'order':
      return q(`[data-order="${cssId(focus.order_id)}"]`);
    case 'line':
      return q(`[data-line="${cssId(focus.order_item_id)}"]`);
    case 'late':
      // LateCard.tsx: data-alerts is the comma list of the group's alert ids (ids.join())
      return [...root.querySelectorAll<HTMLElement>('[data-alerts]')].find((el) => (el.dataset['alerts'] ?? '').split(',').includes(focus.alert_id)) ?? null;
    case 'item':
      return q(`[data-zone-item="${cssId(`${focus.zone_id}:${focus.item_id}`)}"]`);
    case 'alert':
      return q(`[data-alert="${cssId(focus.alert_id)}"]`);
  }
}

/** A folded served round (02b Round: `.rnd > .rnd__h[aria-expanded="false"]`) hides its lines; the screen unfolds it
 *  for the focus (forceOpen), so the place is taken only once it is open. */
function collapsed(el: HTMLElement): boolean {
  return el.closest('.rnd')?.querySelector(':scope > .rnd__h[aria-expanded="false"]') != null;
}

const nextFrame = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
};

/**
 * Rule 2 "open": once the place's element is rendered (its screen loads after the navigation), scroll it into view,
 * glow it and say "Opened …" (focusPlace), then drop `focus` from the hash (consumed once, §3.13.5). An element
 * that never appears (§3.13.4: a line hidden by a filter) gets no glow and no toast.
 *
 * The first lookup waits until the new route has rendered (#253 review: the old screen may hold a matching element,
 * e.g. an #/orders row with the same data-order): after the hashchange when the hash moves, then one animation
 * frame, so the screen has seen the new focus. A place inside a folded round is skipped until it unfolds.
 */
/** The arrival still waiting, if any: a newer tap's arrival ends it (it neither glows nor consumes the new focus). */
let pendingArrival: (() => void) | null = null;

export function glowOnArrival(href: string, focus: StaffFocus, label: string, opts: { moving?: boolean; root?: ParentNode } = {}): Promise<boolean> {
  const root = opts.root ?? document;
  pendingArrival?.();
  return new Promise((resolve) => {
    let done = false;
    let observer: MutationObserver | null = null;
    const look = () => {
      const el = findPlace(href, focus, root);
      return el !== null && !collapsed(el) ? el : null;
    };
    const stop = () => {
      done = true;
      observer?.disconnect();
      clearTimeout(timer);
      window.removeEventListener('hashchange', onHash);
      if (pendingArrival === cancel) pendingArrival = null;
    };
    const cancel = () => {
      if (done) return;
      stop();
      resolve(false);
    };
    const finish = (el: HTMLElement | null) => {
      if (done) return;
      stop();
      if (el !== null) focusPlace(el, label);
      consumeFocus();
      resolve(el !== null);
    };
    pendingArrival = cancel;
    const start = () =>
      nextFrame(() => {
        if (done) return;
        const now = look();
        if (now !== null) return finish(now);
        observer = new MutationObserver(() => {
          const el = look();
          if (el !== null) finish(el);
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-table', 'data-seating', 'data-order', 'data-line', 'data-alerts', 'data-zone-item', 'data-alert', 'aria-expanded'],
        });
      });
    const onHash = () => {
      window.removeEventListener('hashchange', onHash);
      start();
    };
    const timer = setTimeout(() => finish(null), ARRIVAL_MS);
    if (opts.moving === true) window.addEventListener('hashchange', onHash);
    else start();
  });
}

/** §3.13.2: a tap on an alert row, from any surface. */
export async function tapAlert(row: TapRow, deps: TapDeps): Promise<TapOutcome> {
  deps.seen(); // rule 3: seen in every case, before any read (rule 7: the banner hides)
  const target = row.target ?? null;
  // rule 1: a kind with no place (8, 12, 13, 18, 19), a copy kind without a link, a pre-v1.3 row, an unknown type
  if (target === null) {
    deps.openSheet();
    return 'sheet';
  }
  // §3.13.5 m12 (dl cp7, integrator ruling (a)): on #/pass, an order whose Pass card is on the screen glows in place:
  // no read, no navigation. Seen above, once (rule 3); a stale tap does nothing. Rule 4 (DL Q-1 (a)): a row this viewer
  // can answer then gets AnswerSheet on top; a lock-only or not answerable row (the Pass escalation) gets no sheet.
  const onPass = passPlace(target);
  if (onPass !== null) {
    if (deps.isCurrent?.() === false) return 'stale';
    focusPlace(onPass, passOpenedText(target.type === 'order' ? target.order_id : ''));
    if (canAnswer(row)) deps.openSheet();
    return 'navigated';
  }
  const answerable = canAnswer(row);
  const notice = NOTICE_KINDS.has(row.kind);
  const check = checkTarget({ alert_id: row.alert_id, kind: row.kind, raised_at: row.raised_at, state: row.state, target }, deps);
  // rules 4, 5 (B2, B3): a read that hangs never keeps the approver from AnswerSheet, or a notice from its facts:
  // past the timeout the sheet opens over the current screen (as for any other failed check); the late result is dropped
  const checked = answerable || notice ? await withTimeout(check, deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS) : await check;
  // a newer tap, a session change or a route change during the check: this tap is over
  if (deps.isCurrent?.() === false) return 'stale';
  // rule 6 (M5): a banner's Open while a popup is open (now, after the check: one that opened meanwhile counts too)
  // behaves as in v1.2.5 (the detail over the current screen), so no dialog is torn down by a banner. Inbox and
  // Requests taps come from their own routes. One check, after the read (#257 review 2: no second, earlier one).
  if (deps.source === 'banner' && (deps.dialogOpen ?? pageDialogOpen)()) {
    deps.openSheet();
    return 'sheet';
  }
  if (checked === TIMED_OUT) {
    deps.openSheet();
    return 'sheet';
  }
  // §3.13.3: the request's own state first, also when it closed while the check ran (the live row, or alert_closed)
  const result: CheckResult = REQUEST_KINDS.has(row.kind) && deps.stateNow?.() === 'closed' ? { kind: 'request_closed' } : checked;
  if ((answerable && result.kind !== 'open' && result.kind !== 'request_closed') || (notice && result.kind !== 'open')) {
    // rule 4 (B2): not open, 403, NETWORK, 5xx, any read error → AnswerSheet over the current screen exactly as
    // today: no navigation, no glow, no "not open" toast. The hub's AnswerRequest decides, as today.
    // rule 5 (B3): a notice that is not open (an approved full void) or cannot be checked → NoticeSheet over the
    // current screen instead of the toast, so no notice loses its facts.
    deps.openSheet();
    return 'sheet';
  }
  switch (result.kind) {
    case 'open': {
      const moving = window.location.hash !== `#${result.href}`;
      deps.navigate(result.href);
      const label = openedText(row, result.focus);
      (deps.arrive ?? ((href, focus, text) => void glowOnArrival(href, focus, text, { moving })))(result.href, result.focus, label);
      // rule 4 (DL Q-1 (a)): after the navigation and the glow start, AnswerSheet on top (the glow runs behind its
      // scrim). It opens even when the place's element never renders (§3.13.4). A viewer who may not answer (a
      // kiosk's lock-only row, informed, the requester) only navigates.
      // rule 5 (DL Q-3 (a)): a notice the same way, NoticeSheet on top with all of today's facts.
      if (answerable || notice) deps.openSheet();
      return 'navigated';
    }
    case 'no_place':
      // §3.13.3 m5: an open slip with no order place left → today's tap (rule 1)
      deps.openSheet();
      return 'sheet';
    case 'not_open':
    case 'request_closed':
      deps.toast(t('alerts.target_closed'));
      return 'not_open';
    case 'cannot_check':
      deps.toast(checkErrorText(result.error));
      return 'cannot_check';
  }
}
