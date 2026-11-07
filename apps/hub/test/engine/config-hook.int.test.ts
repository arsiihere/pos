// 03a task 24: the config hook (§3.11, 01a S43; test #70), its E() wired into task 22's configStale (§3.11 catch-up,
// boot step 6) and the catch-up give-up (batch 9 carried item: a catch-up that keeps throwing never blocks the fires).
import { performance } from 'node:perf_hooks';
import { canonicalJson } from '@pos/domain/hash';
import type { EngineState } from '@pos/engine';
import { BranchConfigSnapshotSchemaV3, EngineConfigAppliedPayload, type BranchConfig, type ConfigItem, type ConfigStation, type EngineConfig, type PosEvent } from '@pos/events';
import { aBranchConfig, aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { engineStep6, registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { engineConfigHook, engineConfigOf } from '../../src/engine-host/config-hook';
import { firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { configStaleFor, setEngineConfigOf } from '../../src/engine-host/fires-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import type { WriterTx } from '../../src/engine-host/writer';
import type { BootContext } from '../../src/lib/boot';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { onBranchConfigApplied, swapBranchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { statementCounter } from '../helpers/statement-counter';
import { stubConfigCloud, type StubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { draftOf, fakeSubmit } from './fakes';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

const station = (o: Partial<ConfigStation> & { station_id: string }): ConfigStation => ({ ...aBranchConfig().stations[0]!, name: o.station_id, ...o });
const item = (o: Partial<ConfigItem> & { item_id: string }): ConfigItem => ({ ...aBranchConfig().items[1]!, name: o.item_id, ...o });
const entry = (c: BranchConfig) => ({ config: c, snapshotHash: 'h', configVersion: c.config_version, snapshotSchemaVersion: 3, appliedAt: 1 });
const refOf = (c: EngineConfig, id: string): number => c.stations.find((s) => s.station_id === id)!.reference_cook_ms;

describe('03a task 24: the config hook (§3.11)', () => {
  let hub: TestHub;
  let cloud: StubConfigCloud;
  const cleanups: Array<() => unknown> = [];

  beforeEach(async () => {
    cloud = stubConfigCloud();
    hub = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    swapBranchConfig(null);
    hostFlags.configStale = false;
    await hub.close();
  });

  const engine = (): EngineState => hub.deps.state.get();
  const apply = async (c: BranchConfig): Promise<void> => {
    cloud.respondWithSnapshot(c as unknown as Record<string, unknown>);
    const result = await configPoller(hub.app).pollOnce();
    expect(result.outcome).toBe('applied');
  };
  const engineEvents = (): PosEvent[] => hub.published.flat().filter((e) => e.event_type === 'EngineConfigApplied');
  // The hook alone, in its own writer.run on the current state (as 01a runs it inside the apply).
  const runHook = (next: BranchConfig): PosEvent[] => hub.deps.writer.run((tx) => engineConfigHook(null, next, tx)).appended;

  // ------------------------------------------------------------------------------------------------------------ E()
  describe('E(next): exactly the EngineConfigAppliedV1 fields', () => {
    it('E(aBranchConfig()) is the anEngineConfigApplied payload, a strict valid payload', () => {
      const e = engineConfigOf(aBranchConfig());
      expect(e).toEqual(anEngineConfigApplied().payload);
      expect(EngineConfigAppliedPayload.parse(e)).toEqual(e);
    });

    it('stations sorted by station_id (the snapshot sorts by name), archived ones kept, location_label and table_lock_ttl_ms dropped', () => {
      const c = aBranchConfig({
        config_version: 7,
        stations: [
          station({ station_id: 'S9', name: 'A grill', location_label: 'back', is_archived: true }),
          station({ station_id: 'S2', name: 'B tandoor', station_type: 'batch', programs: [{ program_id: 'PR1', name: 'Naan', cook_time_ms: 90_000, is_archived: false }] }),
        ],
      });
      const e = engineConfigOf(c);
      expect(e.config_version).toBe(7);
      expect(e.stations.map((s) => s.station_id)).toEqual(['S2', 'S9']);
      expect(e.stations[1]).toMatchObject({ is_archived: true, name: 'A grill' });
      expect(e.stations[0]!.programs).toEqual(c.stations[1]!.programs);
      expect(e.stations[1]).not.toHaveProperty('location_label');
      expect(e.settings).not.toHaveProperty('table_lock_ttl_ms');
      expect(EngineConfigAppliedPayload.parse(e)).toEqual(e);
    });
  });

  // ---------------------------------------------------------------------------------------------- reference_cook_ms
  describe('reference_cook_ms (§3.11 v0.4 G2 #24)', () => {
    it('the lower median for an even count, the median for an odd one, over the station\'s own items', () => {
      const c = aBranchConfig({
        stations: [station({ station_id: 'S1' }), station({ station_id: 'S2' })],
        items: [
          item({ item_id: 'A', cook_time_ms: 400_000 }),
          item({ item_id: 'B', cook_time_ms: 100_000 }),
          item({ item_id: 'C', cook_time_ms: 300_000 }),
          item({ item_id: 'D', cook_time_ms: 200_000 }),
          item({ item_id: 'E', cook_time_ms: 900_000, station_id: 'S2' }),
          item({ item_id: 'F', cook_time_ms: 500_000, station_id: 'S2' }),
          item({ item_id: 'G', cook_time_ms: 700_000, station_id: 'S2' }),
        ],
      });
      const e = engineConfigOf(c);
      expect(refOf(e, 'S1')).toBe(200_000); // 100, 200 | 300, 400 → the lower of the two middles
      expect(refOf(e, 'S2')).toBe(700_000); // 500, 700, 900
    });

    it('base items only: variants are not counted, and the item\'s cook_time_ms, never its stock_time_ms', () => {
      const c = aBranchConfig({
        items: [
          item({ item_id: 'A', cook_time_ms: 600_000, stock_time_ms: 60_000 }),
          item({ item_id: 'V1h', cook_time_ms: 10_000, variant_group_id: 'V1', variant_name: 'Half' }),
          item({ item_id: 'V1f', cook_time_ms: 20_000, variant_group_id: 'V1', variant_name: 'Full' }),
        ],
      });
      expect(refOf(engineConfigOf(c), 'S1')).toBe(600_000);
    });

    it('an archived item (absent from the snapshot, 01a S22) no longer counts', () => {
      const items = [item({ item_id: 'A', cook_time_ms: 100_000 }), item({ item_id: 'B', cook_time_ms: 300_000 }), item({ item_id: 'C', cook_time_ms: 500_000 })];
      expect(refOf(engineConfigOf(aBranchConfig({ items })), 'S1')).toBe(300_000);
      const archivedB = items.filter((i) => i.item_id !== 'B');
      expect(refOf(engineConfigOf(aBranchConfig({ items: archivedB })), 'S1')).toBe(100_000);
    });

    it('0 when the station has no base item routed to it', () => {
      const c = aBranchConfig({
        stations: [station({ station_id: 'S1' }), station({ station_id: 'S2' })],
        items: [item({ item_id: 'V', variant_group_id: 'V1', variant_name: 'Half', cook_time_ms: 50_000 })],
      });
      const e = engineConfigOf(c);
      expect(refOf(e, 'S1')).toBe(0);
      expect(refOf(e, 'S2')).toBe(0);
      expect(refOf(engineConfigOf(aBranchConfig({ items: [] })), 'S1')).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------------------ #70
  describe('[03a #70] one EngineConfigApplied only when the engine part changed', () => {
    it('the first apply writes one, in the apply\'s transaction; an engine change at the next version writes one more', async () => {
      const c1 = aBranchConfig({ branch_id: BRANCH, config_version: 1 });
      await apply(c1);
      expect(hub.published.map((batch) => batch.map((e) => e.event_type))).toEqual([['BranchConfigApplied', 'EngineConfigApplied']]);
      expect(engineEvents()[0]).toMatchObject({ stream_type: 'station', stream_id: BRANCH, actor_id: null, device_id: 'hub', payload: engineConfigOf(c1) });
      expect(engine().config).toEqual(engineConfigOf(c1));
      const c2 = aBranchConfig({ branch_id: BRANCH, config_version: 2, stations: [station({ station_id: 'S1', name: 'Karahi', capacity: 6 })] });
      await apply(c2);
      expect(engineEvents()).toHaveLength(2);
      expect(engine().config).toEqual(engineConfigOf(c2));
      expect(engine().config!.stations[0]!.capacity).toBe(6);
    });

    it('a price change → none (the engine part, config_version included, is equal)', () => {
      const c1 = aBranchConfig({ branch_id: BRANCH, config_version: 3 });
      expect(runHook(c1).map((e) => e.event_type)).toEqual(['EngineConfigApplied']);
      const priced = { ...c1, items: c1.items.map((i) => ({ ...i, price_minor: i.price_minor + 5_000 })) };
      expect(runHook(priced)).toEqual([]);
      const named = { ...c1, currency_code: 'USD', categories: [{ ...c1.categories[0]!, name: 'Renamed' }] };
      expect(runHook(named)).toEqual([]);
      // An engine field at the same version does write.
      const slower = { ...c1, items: c1.items.map((i) => ({ ...i, cook_time_ms: i.cook_time_ms + 60_000 })) };
      expect(runHook(slower).map((e) => e.event_type)).toEqual(['EngineConfigApplied']);
    });

    it('proposed (implementer): config_version is a field of E(), so a price change at a new version writes one, differing only in config_version', async () => {
      const c1 = aBranchConfig({ branch_id: BRANCH, config_version: 1 });
      await apply(c1);
      await apply({ ...c1, config_version: 2, items: c1.items.map((i) => ({ ...i, price_minor: 1 })) });
      const [first, second] = engineEvents();
      expect(second!.payload).toEqual({ ...first!.payload, config_version: 2 });
    });

    it('never throws over a fuzz of 200 valid V3 configs; each E() is a valid strict payload and is what the engine folds', () => {
      const random = mulberry32(24);
      for (let n = 0; n < 200; n += 1) {
        const c = BranchConfigSnapshotSchemaV3.parse(fuzzConfig(random, n));
        let appended: PosEvent[] = [];
        expect(() => {
          appended = runHook(c);
        }).not.toThrow();
        const e = engineConfigOf(c);
        expect(EngineConfigAppliedPayload.parse(e)).toEqual(e);
        expect(appended.length).toBeLessThanOrEqual(1);
        expect(canonicalJson(engine().config)).toBe(canonicalJson(e));
      }
    });

    it('0 extra statements: the hook reads nothing; unchanged → no statement at all; changed → only its append\'s', () => {
      const counter = statementCounter(hub.deps.db);
      const measure = (next: BranchConfig): { hook: number; append: number; events: number } => {
        let inAppend = 0;
        let total = 0;
        const { appended } = hub.deps.writer.run((tx) => {
          const original = tx.append.bind(tx);
          const counted: WriterTx = {
            ...tx,
            append: (drafts) => {
              const before = counter.count;
              const out = original(drafts);
              inAppend += counter.count - before;
              return out;
            },
          };
          const before = counter.count;
          engineConfigHook(null, next, counted);
          total = counter.count - before;
        });
        return { hook: total - inAppend, append: inAppend, events: appended.length };
      };
      const c1 = aBranchConfig({ branch_id: BRANCH });
      // The append's own statements (appendEvents and the projections of the event) are the writer's, not the hook's.
      expect(measure(c1)).toMatchObject({ hook: 0, events: 1 });
      expect(measure({ ...c1, currency_code: 'USD' })).toEqual({ hook: 0, append: 0, events: 0 });
    });

    it('a hub with no engine state (01a §2: {}) is left alone', () => {
      hub.deps.state.swap({} as EngineState);
      expect(runHook(aBranchConfig())).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------- configStale
  describe('configStale (§3.11 catch-up)', () => {
    const step6 = (): void => {
      engineStep6({ config: hub.deps.config, db: hub.deps.db, initialState: engine(), clock: hub.clock } as BootContext);
    };

    it('E() is wired by the server build (step 5), before boot step 6 reads it', () => {
      swapBranchConfig(entry(aBranchConfig()));
      expect(engine().config).toBeNull();
      step6();
      expect(hostFlags.configStale).toBe(true);
      expect(configStaleFor(engine())).toBe(true);
    });

    it('every hook run re-evaluates it: false after a committed apply; unchanged when the apply rolls back', async () => {
      hostFlags.configStale = true;
      cleanups.push(
        onBranchConfigApplied(() => {
          throw new Error('another hook fails');
        }),
      );
      cloud.respondWithSnapshot(aBranchConfig({ branch_id: BRANCH }) as unknown as Record<string, unknown>);
      const failed = await configPoller(hub.app).pollOnce();
      expect(failed).toMatchObject({ outcome: 'rejected' });
      // S43's retry of the config part alone runs every hook again, so it fails too: nothing commits, the flag stays.
      expect(engine().config).toBeNull();
      expect(hostFlags.configStale).toBe(true);
      cleanups.pop()?.();
      await apply(aBranchConfig({ branch_id: BRANCH, config_version: 2 }));
      expect(hostFlags.configStale).toBe(false);
      expect(configStaleFor(engine())).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------- catch-up give-up (batch 9)
  describe('a catch-up that throws again and again', () => {
    it('proposed (implementer): after 3 failed catch-up passes the fires pass logs once and goes on; the fires still run', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      vi.spyOn(firesAlertsTick, 'due').mockReturnValue(false);
      const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };
      const stop = startTickLoop(hub.deps, log);
      cleanups.push(stop);
      hub.deps.writer.run((tx) => tx.append([draftOf(anEngineConfigApplied()), draftOf(aBusinessDayOpened())]));
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      fakeSubmit(hub.deps, { order_id: 'O1', lines: [{ order_item_id: 'A' }] });
      swapBranchConfig(entry(aBranchConfig({ config_version: 2 })));
      cleanups.push(() => setEngineConfigOf(engineConfigOf));
      setEngineConfigOf(() => {
        throw new Error('E() failed');
      });
      hostFlags.configStale = true;
      hub.clock.set(hub.clock.branchNow() + 60 * 60_000);
      hub.published.length = 0;
      for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(hub.published).toHaveLength(0);
      expect(hostFlags.configStale).toBe(true);
      expect(log.error.mock.calls.filter(([obj]) => obj.tick === 'fires')).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(hostFlags.configStale).toBe(false);
      const types = hub.published.flat().map((e) => e.event_type);
      expect(types).toContain('FireDispatched');
      expect(types).not.toContain('EngineConfigApplied');
      const abandoned = (): number => hub.logs().split('fires: config catch-up abandoned').length - 1;
      expect(abandoned()).toBe(1);
      for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(abandoned()).toBe(1);
      expect(log.error.mock.calls.filter(([obj]) => obj.tick === 'fires')).toHaveLength(3);
    });
  });
});

// ------------------------------------------------------------------------------------------------------------ fuzz
// A seeded generator of valid V3 configs from the aBranchConfig shape: 0–5 stations (ids unique, in name order as
// the snapshot sends them, some archived, slot or batch with programs, alternates, carry times), 0–12 items routed
// to them (plain or variant, any cook / stock time), every engine knob drawn from its range.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fuzzConfig(random: () => number, n: number): BranchConfig {
  const int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const maybe = <T,>(v: T): T | null => (random() < 0.5 ? null : v);
  const orderTypes = ['dine_in', 'takeaway', 'delivery', 'parking'] as const;
  const subset = () => orderTypes.filter(() => random() < 0.5);
  const base = aBranchConfig();
  const ids = Array.from({ length: int(0, 5) }, (_, i) => `S${int(0, 9)}${i}`);
  const stations: ConfigStation[] = ids.map((station_id) => {
    const type = pick(['slot', 'batch'] as const);
    return station({
      station_id,
      name: `${pick(['Grill', 'Tandoor', 'Fry', 'Karahi'])} ${int(0, 99)}`,
      location_label: maybe('back'),
      station_type: type,
      capacity: int(1, 100),
      freshness_window_ms: maybe(int(0, 3_600_000)),
      completion_mode: pick(['two_tap', 'single_tap', 'auto_done'] as const),
      is_archived: random() < 0.2,
      programs:
        type === 'batch'
          ? Array.from({ length: int(0, 3) }, (_, i) => ({ program_id: `PR${station_id}${i}`, name: `P${i}`, cook_time_ms: int(0, 3_600_000), is_archived: random() < 0.2 }))
          : [],
      point_id: pick(['P1', 'P2']),
      policy: pick(['waada_guard', 'edf', 'fifo'] as const),
      freeze_ms: int(0, 900_000),
      min_slack_keep_ms: int(0, 900_000),
      promise_padding_ms: maybe(int(0, 900_000)),
      pressure_window_ms: int(60_000, 3_600_000),
      pressure_amber_bp: int(0, 10_000),
      pressure_red_bp: int(0, 20_000),
      pressure_alert_ms: int(0, 900_000),
      pause_enabled: random() < 0.5,
      lane_units: maybe(int(1, 100)),
      reserve_units: int(0, 10),
      alternates: ids.filter((o) => o !== station_id && random() < 0.3).map((o) => ({ station_id: o, order_types: subset(), home_for_order_types: subset() })),
      carry_times: random() < 0.5 ? [{ point_id: 'P2', carry_ms: int(0, 600_000) }] : [],
    });
  });
  stations.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.station_id < b.station_id ? -1 : 1));
  const items: ConfigItem[] =
    ids.length === 0
      ? []
      : Array.from({ length: int(0, 12) }, (_, i) => {
          const variant = random() < 0.3;
          const cook = int(0, 3_600_000);
          return item({
            item_id: `I${n}-${i}`,
            sort_order: i,
            price_minor: int(0, 1_000_000),
            variant_group_id: variant ? 'V1' : null,
            variant_name: variant ? `V${i}` : null,
            cook_time_ms: cook,
            stock_time_ms: maybe(int(0, cook)),
            station_id: pick(ids),
            weight_pct: int(0, 500),
            max_early_ms: int(0, 900_000),
            max_carry_ms: maybe(int(0, 900_000)),
            max_late_ms: maybe(int(0, 900_000)),
            adjust_time_ms: int(0, 900_000),
          });
        });
  return {
    ...base,
    config_version: n + 1,
    points: [...base.points, { point_id: 'P2', name: 'Window', sort_order: 1, is_archived: random() < 0.2 }],
    stations,
    items,
    stock_items: [],
    engine_settings: {
      ...base.engine_settings,
      weight_dine_in_pct: int(0, 500),
      weight_takeaway_pct: int(0, 500),
      slip_threshold_ms: int(0, 900_000),
      cascade_step_ms: int(0, 900_000),
      returns_boost: random() < 0.5,
      order_abandon_ms: int(0, 86_400_000),
      table_lock_ttl_ms: int(60_000, 3_600_000),
    },
  };
}
