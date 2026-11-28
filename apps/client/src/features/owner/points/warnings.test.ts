import { describe, expect, it } from 'vitest';
import { pointWarnings } from './warnings';

// BUG-8 (01a v2.12 §8.1 QS-1; PT-1, PT-6; 03b §4.4 routePoint): the Points page warns for two active points at the
// same position, a routing tie (two points with the same most specific set for a type, e.g. two Takeaway-only points)
// and a gap (a type no active point accepts). The all-'all' legacy setup shows no tie.

const p = (point_id: string, name: string, sort_order: number, order_types: 'all' | string[] = 'all', archived_at: number | null = null) => ({ point_id, name, sort_order, order_types, archived_at }) as never;

describe('[01a v2.12 QS-1; BUG-8] point warnings', () => {
  it('two Takeaway-only points → a takeaway tie naming both; nothing else', () => {
    const w = pointWarnings([p('A', 'Main Pass', 0), p('B', 'Window 1', 1, ['takeaway']), p('C', 'Window 2', 2, ['takeaway'])]);
    expect(w).toEqual([{ kind: 'tie', order_type: 'takeaway', names: ['Window 1', 'Window 2'] }]);
  });
  it('two active points at the same position → a same-position warning; an archived one does not count', () => {
    const w = pointWarnings([p('A', 'Pass', 2), p('B', 'Window', 2), p('C', 'Old', 2, 'all', 9)]);
    expect(w).toEqual([{ kind: 'same_position', sort_order: 2, names: ['Pass', 'Window'] }]);
  });
  it('a type no active point accepts → a gap; all-"all" points → no tie', () => {
    expect(pointWarnings([p('A', 'Dine Pass', 0, ['dine_in']), p('B', 'Take Pass', 1, ['takeaway'])])).toEqual([{ kind: 'gap', order_type: 'parking' }]);
    expect(pointWarnings([p('A', 'Pass', 0), p('B', 'Pass 2', 1)])).toEqual([]);
  });
});
