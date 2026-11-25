// 02b-TK A2 item 4 (frame HomeRush; MAPPING TK-S01 "rush"; ruling R9: UI only, no kitchen behaviour; CHANGES §6 Q6):
// rush mode is on at RUSH_OPEN_ORDERS open takeaway tokens (counted on the client from the queue rail's open-orders
// rows) or by a tap on the shell's Live / Rush pill. The tap is a manual override kept in this device's localStorage
// (a storage that throws or is blocked is ignored: the count decides); tapping back to what the count says clears it.

/** TODO(Part B, 01a v2.11): the branch setting `rush_open_orders` (default 15) replaces this constant (R9). */
export const RUSH_OPEN_ORDERS = 15;

export const RUSH_KEY = 'pos.tk.rush';

/** On when the override says so, else at RUSH_OPEN_ORDERS open tokens. */
export function rushOn(count: number, manual: boolean | null): boolean {
  return manual ?? count >= RUSH_OPEN_ORDERS;
}

/** The override after a tap on the pill: the opposite of what is shown, or none when that is what the count says. */
export function toggledOverride(count: number, manual: boolean | null): boolean | null {
  const next = !rushOn(count, manual);
  return next === rushOn(count, null) ? null : next;
}

export function readRushOverride(): boolean | null {
  try {
    const v = window.localStorage.getItem(RUSH_KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

export function writeRushOverride(value: boolean | null): void {
  try {
    if (value === null) window.localStorage.removeItem(RUSH_KEY);
    else window.localStorage.setItem(RUSH_KEY, value ? 'on' : 'off');
  } catch {
    // blocked storage: the choice lasts while the screen is open
  }
}
