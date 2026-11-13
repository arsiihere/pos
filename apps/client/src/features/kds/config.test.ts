import type { WsServerMessage } from '@pos/events';
import { describe, expect, it, vi } from 'vitest';
import { flush } from '../../../test/dom';
import { createKdsConfig } from './config';

// 03b v1.0.8 §3.3, §3.10, #75 (K4): the station's config from branch-config; read on open, catch-up, BranchConfigApplied.

const snap = (name: string, mode: string, type = 'slot') => ({
  ok: true as const,
  data: { snapshot: { stations: [{ station_id: 'ST', name, completion_mode: mode, station_type: type, is_archived: false }, { station_id: 'X', name: 'Other', completion_mode: 'two_tap', station_type: 'slot', is_archived: false }] }, hub_time: { now_ms: 5_000, utc_offset_ms: 18_000_000 } },
});
const applied: WsServerMessage = { type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'BranchConfigApplied', schema_version: 1, payload: {} } };

describe('[03b #75] kds config', () => {
  it('[03b #75] BranchConfigApplied → one branch-config read; station name and completion mode follow', async () => {
    const load = vi.fn().mockResolvedValueOnce(snap('Tandoor', 'two_tap')).mockResolvedValueOnce(snap('Tandoor Main', 'single_tap', 'batch'));
    const config = createKdsConfig({ stationId: 'ST', load });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(config.state()).toEqual({ station: { name: 'Tandoor', completion_mode: 'two_tap', station_type: 'slot', is_archived: false }, hub_time: { now_ms: 5_000, utc_offset_ms: 18_000_000 } });
    let heard = 0;
    config.subscribe(() => (heard += 1));
    // other events read nothing (no timer, no read per frame)
    config.onFrame({ type: 'event', seq: 4, event: { event_id: 'E4', event_type: 'ItemStarted', schema_version: 1, payload: {} } });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    config.onFrame(applied);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(config.state().station).toEqual({ name: 'Tandoor Main', completion_mode: 'single_tap', station_type: 'batch', is_archived: false });
    expect(heard).toBe(1);
  });

  it('[03b §3.10] a catch-up reads again; frames during a read give one more read; a failed read keeps the last config', async () => {
    let resolve!: (v: unknown) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce(snap('B', 'auto_done'))
      .mockResolvedValueOnce({ ok: false, error: { kind: 'network' } });
    const config = createKdsConfig({ stationId: 'ST', load });
    config.onFrame(applied);
    config.onFrame({ type: 'catch_up', as_of_seq: 1, state: {} });
    resolve(snap('A', 'two_tap'));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(config.state().station?.name).toBe('B');
    config.onFrame({ type: 'catch_up', as_of_seq: 2, state: {} });
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
    expect(config.state().station?.completion_mode).toBe('auto_done');
    config.dispose();
  });
});
