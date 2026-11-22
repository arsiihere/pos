// 03a v1.2.10 §3.5.7 PR-4 (STAB-7; re-review R-1, final check FC-1), test 174: sustained overload, first come first served
// among priority groups. Property on 50 seeds: a slot station (capacity 2) and a batch station (capacity 8) at about 120 %
// for 30 min, the default max delay 5 min on most items (some "No limit"), the fires tick every 30 s with Start taps, a
// fires_alerts pass that writes every LinePrioritized draft, and a capacity drop on the batch station mid-rush (jumps in
// hidden lands). After every fold:
//   - with `arrival` read from the state (the first listed line's arrived_at), a group listed after A's onset
//     (arrival(B) > onset(A)) never ranks ahead of A, so it never overtakes A (fails with the v1.2.9 key
//     priority_at − priority_delay_ms, which ranks a jumped newer group ahead);
//   - a group's priority_land_ms never moves earlier (Sticky; it moves later only for fixed input or an earlier onset);
//   - priority_due = priorityDueOf (test 106).
// At the end live = replay (snapshot + replay = full replay). No timing asserts (AD-32).
import { parseEvent, type PosEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { applyEvents, buildEngineState, getAlertIntents, getTickIntents, type EngineState } from '../src/index';
import { priorityCmp, priorityRank, type PriorityRank } from '../src/priority';
import { at, batchStation, capacityEv, doneEv, fold, kitchen, M, prioritizedEv, S, stamp, startEv, submit, type Item } from './priority-kit';
import { anItemStarted } from '@pos/events/testing';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const withoutDiag = (s: EngineState): Omit<EngineState, 'diagnostics'> => {
  const { diagnostics: _d, ...rest } = s;
  void _d;
  return rest;
};

function ranks(s: EngineState): PriorityRank[] {
  const out: PriorityRank[] = [];
  for (const o of Object.values(s.orders)) for (const gid of Object.keys(o.groups)) {
    const r = priorityRank(s, o.order_id, gid);
    if (r !== null) out.push(r);
  }
  return out;
}

function check(s: EngineState, lands: Map<string, number>): number {
  const rs = ranks(s);
  const cmp = priorityCmp(s);
  let pairs = 0;
  for (const A of rs) {
    for (const B of rs) {
      if (A === B) continue;
      const arrivalB = s.lines[s.orders[B.first.order_id]!.groups[B.group_id]!.line_ids.find((id) => s.lines[id] !== undefined)!]!.arrived_at;
      if (arrivalB > A.onset) {
        pairs++;
        expect(cmp(A, B), `${B.group_id} listed after ${A.group_id}'s onset ranks after it`).toBeLessThan(0);
      }
    }
  }
  for (const o of Object.values(s.orders)) {
    for (const [gid, g] of Object.entries(o.groups)) {
      if (g.priority_land_ms === null) continue;
      const before = lands.get(gid);
      if (before !== undefined) expect(g.priority_land_ms, `${gid} priority_land_ms never earlier`).toBeGreaterThanOrEqual(before);
      lands.set(gid, g.priority_land_ms);
    }
  }
  return pairs;
}

function runSeed(seed: number): { live: EngineState; log: PosEvent[]; prioritized: number; pairs: number } {
  const rnd = prng(seed);
  const log: PosEvent[] = [];
  const lands = new Map<string, number>();
  let s = kitchen([{ station_id: 'S1', capacity: 2 }, batchStation('F')], {}, log);
  let pairs = 0;
  const step = (events: PosEvent[]): void => {
    for (const e of events) {
      s = fold(s, [e], log);
      pairs += check(s, lands);
    }
  };
  const startAt = new Map<string, number>();
  let n = 0;
  let prioritized = 0;
  for (let t = at(0); t <= at(45); t += 30 * S) {
    // ≈ 120 %: S1 (2 units) gets a 6–10 min line about every 3 min; F (8 per 3 min) 2–4 parts about every minute.
    if (t <= at(30)) {
      if (rnd() < 0.18) {
        const id = `O${n++}`;
        const items: Item[] = [{ id: `${id}s`, station: 'S1', cook: (6 + Math.floor(rnd() * 5)) * M, maxDelay: rnd() < 0.8 ? 5 * M : null }];
        if (rnd() < 0.5) items.push({ id: `${id}b`, station: 'F', cook: 3 * M, batch: true, early: 2 * M, maxDelay: 5 * M });
        s = submit(s, id, items, t, {}, log).state;
        pairs += check(s, lands);
      }
      if (rnd() < 0.5) {
        const id = `O${n++}`;
        const k = 2 + Math.floor(rnd() * 3);
        const items: Item[] = Array.from({ length: k }, (_, j) => ({ id: `${id}p${j}`, station: 'F', cook: 3 * M, batch: true, mode: 'immediate' as const, early: 60 * M, maxDelay: rnd() < 0.8 ? 5 * M : null }));
        s = submit(s, id, items, t, {}, log).state;
        pairs += check(s, lands);
      }
    }
    if (t === at(15)) step([capacityEv('F', 4, t)]);
    if (t === at(22)) step([capacityEv('F', null, t)]);
    // Starts and Dones due now.
    for (const [id, when] of [...startAt]) {
      if (when > t) continue;
      startAt.delete(id);
      const l = s.lines[id];
      if (l !== undefined && l.stage === 'added' && l.fired_at !== null) step([startEv(l.order_id, id, t)]);
    }
    for (const l of Object.values(s.lines)) {
      if (l.stage === 'cooking' && l.started_at! + l.prep_ms + l.cook_ms <= t) step([doneEv(l.order_id, l.order_item_id, t)]);
    }
    const drafts = getTickIntents(s, t);
    step(drafts.map((d) => stamp({ ...anItemStarted(), ...d, payload: d.payload as unknown as Record<string, unknown>, actor_id: null, device_id: 'hub' }, t)));
    for (const d of drafts) {
      if (d.event_type !== 'FireDispatched') continue;
      for (const id of (d.payload as { order_item_ids: string[] }).order_item_ids) startAt.set(id, t + Math.floor(rnd() * 3) * M);
    }
    const p = getAlertIntents(s, t).prioritized;
    prioritized += p.length;
    step(p.map((d) => prioritizedEv(d, t)));
  }
  return { live: s, log, prioritized, pairs };
}

describe('[03a v1.2.10 §3.5.7 PR-4, FC-1] property: first come, first served among priority groups (50 seeds)', () => {
  it('[03a #174] no group listed after A\'s onset overtakes A; priority_land_ms never earlier; live = replay', () => {
    let prioritized = 0;
    let pairs = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = runSeed(seed);
      prioritized += r.prioritized;
      pairs += r.pairs;
      const parsed = r.log.map((e) => parseEvent(e));
      expect(withoutDiag(buildEngineState(parsed)), `seed ${seed} replay`).toEqual(withoutDiag(r.live));
      if (seed % 10 === 0) {
        const k = Math.floor(parsed.length / 2);
        const snap = JSON.parse(JSON.stringify(buildEngineState(parsed.slice(0, k)))) as EngineState;
        expect(withoutDiag(applyEvents(snap, parsed.slice(k))), `seed ${seed} snapshot`).toEqual(withoutDiag(r.live));
      }
    }
    // The harness exercises the rule: groups become priority and later-listed groups exist beside them.
    expect(prioritized).toBeGreaterThan(50);
    expect(pairs).toBeGreaterThan(0);
  }, 240_000);
});
