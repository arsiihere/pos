// 02b-TK A2 item 4 (frames HomeRush, ShellAnatomy; MAPPING TK-SH01 `.tk-live--rush`): the takeaway screen tells the
// top bar its rush state — on / off, the open-token count and the toggle — and clears it when it goes; the bar draws
// the Live pill as that toggle ("Rush mode · 40" when on). Off the takeaway screen the pill is the plain Live pill.

export interface RushPill {
  on: boolean;
  count: number;
  toggle(): void;
}

export interface RushSlotStore {
  get(): RushPill | null;
  set(value: RushPill | null): void;
  subscribe(listener: () => void): () => void;
}

export function createRushSlot(): RushSlotStore {
  let value: RushPill | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
