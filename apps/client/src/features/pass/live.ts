import type { WsServerMessage } from '@pos/events';
import type { HubResult } from '../../api/hub-admin';
import { publishFrame } from '../kds/slots';
import type { RosterPerson } from '../staff/api';
import type { LiveBus } from '../staff/shell/live';
import { createPassNames, type PassNames } from './names';
import { createPassStore, type PassStoreImpl } from './store';

// 03b v1.0.8 §3.4, §8 (P1; Q-50, Q-55): the Pass's live layer on the staff page. A Pass tablet is a staff socket, so
// the Pass reads the staff shell's live bus: its `catch_up` and seq-ordered `event` messages go to the Pass store and
// then to the slots' frame feed (`publishFrame`, so 03c reads `kds_printed` / `printed_lines` / `station_notice`).
// The bus carries only those two types; the socket's other frames (`point_lines`, `station_takeover`,
// `station_notice`, `station_plan`, `printed_lines`) come in through `frame()`, which the staff page's socket
// `onFrame` calls next to `liveBus.frame` — in arrival order, so both paths keep the socket's order.
// Each catch-up with a `point_view` reads `staff-roster` once (names, Q-55). One live per staff page (`passLiveOf`).
// IR-17b: a live created after the bus's catch-up starts empty and publishes nothing — the bus's parts are as of
// that catch-up, without the events since, so replaying them would show stale handover state. The staff page creates
// it once, before the socket opens (W0.6), so it always sees the first catch-up; else it fills at the next one.

export interface PassLive {
  store: PassStoreImpl;
  names: PassNames;
  /** a socket frame the live bus does not carry; `catch_up` / `event` are ignored here (the bus delivers them) */
  frame(frame: WsServerMessage): void;
  dispose(): void;
}

export interface PassLiveDeps {
  live: LiveBus;
  /** the hub clock (Q-55) */
  now: () => number;
  roster: () => Promise<HubResult<{ staff: RosterPerson[] }>>;
}

export function createPassLive(deps: PassLiveDeps): PassLive {
  const store = createPassStore({ now: deps.now });
  const names = createPassNames(deps.roster);
  let alive = true;

  const feed = (frame: WsServerMessage) => {
    if (!alive) return;
    store.apply(frame);
    publishFrame(frame);
    if (frame.type === 'catch_up' && frame.state['point_view'] !== undefined) names.refresh();
  };

  const off = deps.live.subscribe((m) => {
    if (m.kind === 'catch_up') feed({ type: 'catch_up', as_of_seq: m.as_of_seq, state: m.state });
    else if (m.kind === 'event') feed({ type: 'event', seq: m.seq, event: m.event });
  });

  return {
    store,
    names,
    frame(frame) {
      if (frame.type === 'catch_up' || frame.type === 'event') return;
      feed(frame);
    },
    dispose() {
      alive = false;
      off();
      if (lives.get(deps.live) === this) lives.delete(deps.live);
    },
  };
}

const lives = new WeakMap<LiveBus, PassLive>();

/** The page's one Pass live for this shell's bus (created on first use). */
export function passLiveOf(shell: { live: LiveBus; clock: { nowMs(): number }; api: { roster: PassLiveDeps['roster'] } }): PassLive {
  let pass = lives.get(shell.live);
  if (pass === undefined) {
    pass = createPassLive({ live: shell.live, now: () => shell.clock.nowMs(), roster: () => shell.api.roster() });
    lives.set(shell.live, pass);
  }
  return pass;
}
