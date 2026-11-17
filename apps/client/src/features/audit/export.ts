import { hubTimeText } from '../../app/hub-clock';
import { t } from '../../i18n';
import type { AuditApi, AuditEntryView, AuditQuery } from './api';
import { isoDay, DAY_MS, type DayRange } from './days';
import { actionText, detailOf, methodOf, outcomeOf, reasonText, shortId } from './labels';

// 04 v1.0.4 §8 Export CSV (V17; 04-D09): the browser pages the same §6.5 audit-log query (same filters, the range is ≤ 31 days
// by construction) by meta.next_cursor at the largest page (limit 200) and builds the file itself; no other endpoint.
// One header row, one line per entry in the screen's words; CRLF lines, a BOM so a spreadsheet reads Urdu names.

export const EXPORT_PAGE = 200;

const SEP = ',';
const EOL = '\r\n';

/** RFC 4180 quoting; a field a spreadsheet would run as a formula (= + - @) gets a leading apostrophe. */
function field(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rupees(minor: number | null): string | null {
  return minor === null ? null : (minor / 100).toFixed(2);
}

export function csvOf(entries: readonly AuditEntryView[], utcOffsetMs: number): string {
  const head = [
    t('audit.f.date'),
    t('audit.col.time'),
    t('audit.col.who'),
    t('audit.col.action'),
    t('audit.csv.table'),
    t('audit.csv.item'),
    t('audit.csv.units'),
    t('audit.col.reason'),
    t('audit.col.outcome'),
    t('audit.col.amount'),
    t('audit.col.approver'),
    t('audit.csv.method'),
  ];
  const lines = [head.map(field).join(SEP)];
  for (const e of entries) {
    const d = detailOf(e);
    const item = typeof d['item'] === 'string' ? d['item'] : typeof d['device_name'] === 'string' ? d['device_name'] : null;
    const units = typeof d['units'] === 'number' ? d['units'] : null;
    const method = methodOf(e, d);
    const who = e.actor_name ?? (e.actor_staff_id === null ? null : shortId(e.actor_staff_id));
    const approver = e.approver_name ?? (e.approver_staff_id === null ? null : shortId(e.approver_staff_id));
    lines.push(
      [
        isoDay(e.recorded_at, utcOffsetMs),
        hubTimeText(e.recorded_at, utcOffsetMs),
        who,
        actionText(e.action),
        e.table_name ?? e.table_code,
        item,
        units,
        reasonText(e.action, e.reason),
        outcomeOf(e.outcome)?.text ?? e.outcome,
        rupees(e.amount_minor),
        approver,
        method === null ? null : t(method === 'in_person' ? 'audit.method.in_person' : 'audit.method.on_requester_device'),
      ]
        .map(field)
        .join(SEP),
    );
  }
  return '﻿' + lines.join(EOL) + EOL;
}

/** `audit-<branch>-<from>-to-<to>.csv`: the branch name as a slug, the first and the last whole hub day. */
export function exportFileName(branchName: string, r: DayRange, utcOffsetMs: number): string {
  const slug =
    branchName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'branch';
  return `audit-${slug}-${isoDay(r.from, utcOffsetMs)}-to-${isoDay(r.to - DAY_MS, utcOffsetMs)}.csv`;
}

export type ExportResult = { kind: 'done'; entries: AuditEntryView[] } | { kind: 'stopped' } | { kind: 'failed'; network: boolean };

/** Pages the query to its end; `progress(rows, oldest recorded_at)` after each page; `stopped()` is asked between pages. */
export async function collect(api: AuditApi, q: AuditQuery, progress: (rows: number, oldest: number | null) => void, stopped: () => boolean): Promise<ExportResult> {
  const all: AuditEntryView[] = [];
  let cursor: string | null = null;
  for (;;) {
    const answer = await api.auditLog(q, cursor, EXPORT_PAGE);
    if (stopped()) return { kind: 'stopped' };
    if (!answer.ok) return { kind: 'failed', network: answer.error.kind === 'network' };
    all.push(...answer.data.entries);
    progress(all.length, all.at(-1)?.recorded_at ?? null);
    cursor = answer.data.next_cursor;
    if (cursor === null) return { kind: 'done', entries: all };
  }
}

/** Saves a text file in the browser (a Blob behind a download link). */
export function saveInBrowser(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
