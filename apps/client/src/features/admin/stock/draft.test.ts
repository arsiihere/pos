import type { HubStockItem, HubStockItemMeta } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { draftKey, loadDraft, restoreDraft, saveDraft } from './draft';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const meta = (id: string, o: Partial<HubStockItemMeta> = {}) =>
  ({ item_id: id, name: id, is_stock_tracked: true, stock_unit: 'piece', ...o }) as HubStockItemMeta;
const item = (id: string, o: Partial<HubStockItem> = {}) =>
  ({ item_id: id, on_hand: 5, unit: 'piece', set_at: 100, ...o }) as HubStockItem;

describe('[01a S55] kept counts', () => {
  it('keys by branch, the open day and the staff member; empty drafts are removed', () => {
    const storage = memory();
    const key = draftKey('B1', 1_000, 'S1');
    expect(key).toBe('stock-draft:B1:1000:S1');
    saveDraft(storage, key, { saved_at: 5, entries: [{ item_id: 'I1', on_hand: 3, unit: 'piece', base_set_at: 100 }] });
    expect(loadDraft(storage, 'B1', 1_000, 'S1')?.entries).toHaveLength(1);
    expect(loadDraft(storage, 'B1', 1_000, 'S2')).toBeNull();
    saveDraft(storage, key, { saved_at: 6, entries: [] });
    expect(storage.getItem(key)).toBeNull();
  });

  it('loading deletes drafts of other days for this branch, never another branch', () => {
    const storage = memory();
    saveDraft(storage, draftKey('B1', 900, 'S1'), { saved_at: 1, entries: [{ item_id: 'I1', on_hand: 1, unit: 'piece', base_set_at: null }] });
    saveDraft(storage, draftKey('B1', 900, 'S2'), { saved_at: 1, entries: [{ item_id: 'I1', on_hand: 1, unit: 'piece', base_set_at: null }] });
    saveDraft(storage, draftKey('B2', 900, 'S1'), { saved_at: 1, entries: [{ item_id: 'I1', on_hand: 1, unit: 'piece', base_set_at: null }] });
    expect(loadDraft(storage, 'B1', 1_000, 'S1')).toBeNull();
    expect(storage.getItem(draftKey('B1', 900, 'S1'))).toBeNull();
    expect(storage.getItem(draftKey('B1', 900, 'S2'))).toBeNull();
    expect(storage.getItem(draftKey('B2', 900, 'S1'))).not.toBeNull();
  });

  it('restore drops unknown, untracked and other-unit entries; a row saved since is listed, not touched', () => {
    const rows = [
      { meta: meta('I1'), item: item('I1') },
      { meta: meta('I2'), item: item('I2', { set_at: 200, on_hand: 55 }) },
      { meta: meta('I3', { stock_unit: 'g' }), item: item('I3', { unit: 'g' }) },
      { meta: meta('I4', { is_stock_tracked: false }), item: item('I4') },
    ];
    const out = restoreDraft(
      {
        saved_at: 1,
        entries: [
          { item_id: 'I1', on_hand: 7, unit: 'piece', base_set_at: 100 },
          { item_id: 'I2', on_hand: 40, unit: 'piece', base_set_at: 100 },
          { item_id: 'I3', on_hand: 4, unit: 'piece', base_set_at: 100 },
          { item_id: 'I4', on_hand: 4, unit: 'piece', base_set_at: 100 },
          { item_id: 'I9', on_hand: 4, unit: 'piece', base_set_at: 100 },
        ],
      },
      rows,
    );
    expect([...out.touched]).toEqual([['I1', 7]]);
    expect(out.changed).toEqual([{ item_id: 'I2', name: 'I2', now: 55 }]);
  });

  it('a throwing storage is ignored', () => {
    const storage = memory();
    storage.getItem = () => {
      throw new Error('blocked');
    };
    storage.setItem = () => {
      throw new Error('blocked');
    };
    expect(loadDraft(storage, 'B1', 1, 'S1')).toBeNull();
    expect(() => saveDraft(storage, 'k', { saved_at: 1, entries: [] })).not.toThrow();
    expect(loadDraft(null, 'B1', 1, 'S1')).toBeNull();
  });
});
