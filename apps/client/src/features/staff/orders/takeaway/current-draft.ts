import { newUlid } from '../../../../app/ulid';
import type { DraftStore } from '../contracts';

// 02b v1.0.24 §8 (Ordering screen #35, Held); 02b-TK C2-1; CHANGES §1 "The Takeaway tab is the order screen": the
// Takeaway tab (`#/takeaway`) opens the order screen on ONE current takeaway draft per device and person (drafts
// are kept per device and person, #35). It is the one this tab last used while it is still unsent, else the newest
// unsent takeaway draft of the person (after a reload), else a fresh id — remembered, so a visit never starts a new
// draft and leaves the old one behind. A held draft is never current: it waits in Held. Hold gives the tab a new
// current id (`setCurrentTakeawayDraft`). A blank cart stores nothing, so a fresh id leaves nothing behind either.

const current = new Map<string, string>();
const keyOf = (device_id: string, staff_id: string | null) => `${device_id}\u0000${staff_id ?? ''}`;

export async function currentTakeawayDraft(drafts: DraftStore, device_id: string, staff_id: string | null, newId: () => string = newUlid): Promise<string> {
  const key = keyOf(device_id, staff_id);
  const mine = current.get(key);
  let list: Awaited<ReturnType<DraftStore['list']>> = [];
  if (staff_id !== null) list = await drafts.list(device_id, staff_id).catch(() => []);
  const unsent = list.filter((d) => d.order_type === 'takeaway' && !d.held);
  const heldIds = new Set(list.filter((d) => d.held).map((d) => d.draft_id));
  let id: string;
  if (mine !== undefined && unsent.some((d) => d.draft_id === mine)) id = mine;
  else if (unsent.length > 0) id = unsent.at(-1)!.draft_id; // the list is oldest first (byUpdatedAt)
  else if (mine !== undefined && !heldIds.has(mine)) id = mine;
  else id = newId();
  current.set(key, id);
  return id;
}

/** Hold / auto-hold: the tab's next customer starts on this draft id. */
export function setCurrentTakeawayDraft(device_id: string, staff_id: string | null, draft_id: string): void {
  current.set(keyOf(device_id, staff_id), draft_id);
}

/** Tests: forget every remembered id (a reload). */
export function forgetTakeawayDrafts(): void {
  current.clear();
}
