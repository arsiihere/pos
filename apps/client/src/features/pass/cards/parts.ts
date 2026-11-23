import { groupByPartOf, sumOptionTexts } from '@pos/domain';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { largest } from '../../kds/station/parts';
import type { PointLine, PointOrder } from '../contracts';

// 03b v1.0.11 §3.4 (STAB-5 phase 3; proposal §3.5, owner Q1 = b): a Pass card shows the parts of one `part_of` (02b
// v1.0.20 §3.2 step 4a) with the same stage and hand-over state as one row at the first part's place: units summed,
// options summed by name (as the KDS, §3.3), the other details from the first part. Readiness and Hand over still work
// on the parts as lines (each part is an engine line); only what is shown and what a row's tap sends is grouped.

export interface PassRow {
  /** what the row shows: the first part with the summed units and options */
  line: PointLine;
  /** the lines it stands for, in line order (one for a line that was not split) */
  parts: readonly PointLine[];
}

export function groupLines(lines: readonly PointLine[]): PassRow[] {
  // ⚠️ 03b v1.0.13 §3.4 (STAB-6): + load_id at a batch station, so each round is its own row (card, pick sheet, hand-over)
  return groupByPartOf(lines, (l) => (l.part_of === undefined || l.part_of === null ? null : `${l.part_of} ${l.stage} ${l.handed_over ? 1 : 0} ${l.load_id ?? ''}`)).map((parts) => {
    const first = parts[0]!;
    if (parts.length === 1) return { line: first, parts };
    return {
      line: {
        ...first,
        units: parts.reduce((n, p) => n + p.units, 0),
        options: sumOptionTexts(parts.map((p) => p.options)),
        // ⚠️ 03b v1.0.13 §3.4 (STAB-7): any part priority → the chip, with the largest n
        priority: largest(parts.map((p) => (p.priority == null ? null : { minutes_late: p.priority.minutes_late }))),
      },
      parts,
    };
  });
}

/**
 * ⚠️ 03b v1.0.13 §3.4 (STAB-6; the §3.3 round tag, post-review m-8): each unfinished load's place among its station's
 * unfinished loads the point holds — a load with a started member first (it was fired earlier), then the others in
 * card order (oldest order first) and line order: "this round", "next round", "round n". The Pass has no fire times,
 * so this is its reading of "in fire order" (plan "Where the plan and code did not fit").
 */
export function passRounds(orders: readonly PointOrder[]): Map<string, string> {
  const byStation = new Map<string, { started: string[]; waiting: string[] }>();
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.load_id == null || l.stage === 'done' || l.handed_over) continue;
      const st = byStation.get(l.station_id) ?? { started: [], waiting: [] };
      byStation.set(l.station_id, st);
      if (l.stage === 'cooking') {
        st.waiting = st.waiting.filter((id) => id !== l.load_id);
        if (!st.started.includes(l.load_id)) st.started.push(l.load_id);
      } else if (!st.started.includes(l.load_id) && !st.waiting.includes(l.load_id)) st.waiting.push(l.load_id);
    }
  }
  const out = new Map<string, string>();
  for (const { started, waiting } of byStation.values()) {
    [...started, ...waiting].forEach((id, i) => out.set(id, i === 0 ? t('kds.round.this') : i === 1 ? t('kds.round.next') : fill(t('kds.round.n'), { n: String(i + 1) })));
  }
  return out;
}
