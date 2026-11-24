import type { Draft, DraftStore } from '../contracts';

// 02b-TK C2-5 (02b v1.0.24 §8 Held; frame HeldDrawer; CHANGES §3 "Held: per counter"; ruling R3): the held drafts a
// person sees on this device — their own, and every takeaway / parking draft anyone held on this device (a counter
// is shared). A held dine-in draft stays with the person who held it (it belongs to their table). Newest first.
// A store without a device listing (an older one) gives this person's only.

export async function heldOnDevice(drafts: DraftStore, device_id: string, staff_id: string): Promise<Draft[]> {
  const all = drafts.listDevice === undefined ? await drafts.list(device_id, staff_id) : await drafts.listDevice(device_id);
  // the store lists this device's drafts only (and `list` this person's)
  return all.filter((d) => d.held && (d.staff_id === staff_id || d.order_type !== 'dine_in')).sort((a, b) => b.updated_at - a.updated_at);
}
