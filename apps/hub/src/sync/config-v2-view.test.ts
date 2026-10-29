import { BranchConfigSnapshotSchemaV2 } from '@pos/events';
import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from './branch-config-holder';
import { branchConfigV2, toConfigV2 } from './config-v2-view';

describe('config V2 view (01c plan P-2)', () => {
  afterEach(() => swapBranchConfig(null));

  it('[01c §5.1 P-2] toConfigV2 maps a schema-1 snapshot by the backfill rule: a tracked item becomes a stock item with its own id at its station, with one draw', () => {
    const v1 = aBranchConfigV1();
    const v2 = toConfigV2(v1);
    expect(BranchConfigSnapshotSchemaV2.parse(v2)).toEqual(v2);
    expect(v2.snapshot_schema_version).toBe(2);
    const karahi = v2.stations.find((s) => s.name === 'Karahi')!;
    expect(v2.stock_items).toEqual([
      { stock_item_id: 'I1', name: 'Chicken Karahi', stock_unit: 'piece', carries_over: false, station_id: karahi.station_id, low_stock_threshold: null },
      { stock_item_id: 'I3', name: 'Chicken Karahi — Half', stock_unit: 'g', carries_over: false, station_id: karahi.station_id, low_stock_threshold: null },
    ]);
    const item = (id: string) => v2.items.find((i) => i.item_id === id)!;
    expect(item('I1').stock_draws).toEqual([{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }]);
    expect(item('I3').stock_draws).toEqual([{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }]);
    expect(item('I3')).toMatchObject({ sale_unit: 'piece', variant_group_id: null, variant_name: null, requires_weighing: false, modifier_group_ids: [] });
    expect(item('I2').stock_draws).toEqual([]);
    expect(v2.items.map((i) => i.item_id)).toEqual(['I1', 'I2', 'I3']);
    expect(v2.variant_groups).toEqual([]);
    expect(v2.modifier_groups).toEqual([]);
    expect(v2.deals).toEqual([]);
    expect({ ...v2, items: undefined, stock_items: undefined, variant_groups: undefined, modifier_groups: undefined, deals: undefined, snapshot_schema_version: undefined }).toEqual({
      ...v1,
      items: undefined,
      stock_items: undefined,
      variant_groups: undefined,
      modifier_groups: undefined,
      deals: undefined,
      snapshot_schema_version: undefined,
    });
  });

  it('[01c §5.1 P-2] the threshold and carries_over move to the stock item; an untracked item with a stock time at a batch station gets none', () => {
    const base = aBranchConfigV1();
    const v1 = {
      ...base,
      items: base.items.map((i) => (i.item_id === 'I3' ? { ...i, carries_over: true, low_stock_threshold: 1_000 } : i)),
    };
    expect(toConfigV2(v1).stock_items.find((s) => s.stock_item_id === 'I3')).toMatchObject({ carries_over: true, low_stock_threshold: 1_000 });

    const batch = { ...base, stations: base.stations.map((s) => ({ ...s, station_type: 'batch' as const })) };
    const v2 = toConfigV2(batch);
    expect(v2.stock_items).toEqual([]);
    expect(v2.items.every((i) => i.stock_draws.length === 0)).toBe(true);
  });

  it('[01c §5.1 P-2] memoised per V1 object; branchConfigV2 maps the held snapshot and is null with none', () => {
    const v1 = aBranchConfigV1();
    expect(toConfigV2(v1)).toBe(toConfigV2(v1));
    expect(toConfigV2(aBranchConfigV1())).not.toBe(toConfigV2(v1));
    expect(branchConfigV2()).toBeNull();
    swapBranchConfig({ config: v1, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 1, appliedAt: 0 });
    expect(branchConfigV2()).toBe(toConfigV2(v1));
  });
});
