import { t } from '../../../i18n';

// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu, TokenReady, PayCard, TokenAddItems; MAPPING TK-SH01; R3): the top
// bar's context slot — an icon, one line ("New takeaway · Usman", "Token 57 · Usman") and one sub-line. The screen on
// the route fills it (the takeaway order screen) and clears it when it goes; the shell draws it in place of the brand
// block. The token is its own field so the bar sets it LTR. The customer's name only for view-customer-contact
// holders (R3): anyone else sees no name at all. Nothing is logged.

export interface ContextSlotValue {
  /** "New takeaway" | "Token" */
  label: string;
  /** the token number as shown, or null */
  token: string | null;
  /** the customer's name (view-customer-contact only), or null */
  name: string | null;
  sub: string | null;
  /** ⚠️ 02b-TK L-CLIENT-6b item 4 (frames TokenDue … TokenUrdu): a Back in the bar before the slot; it sends
   *  TK_BACK_EVENT on window and the open layer (the token view) closes. Absent = no Back. */
  back?: boolean;
}

/** The bar's Back (`back: true`): the open takeaway layer listens on window and closes. */
export const TK_BACK_EVENT = 'pos:tk-back';

export interface ContextSlotStore {
  get(): ContextSlotValue | null;
  set(value: ContextSlotValue | null): void;
  subscribe(listener: () => void): () => void;
}

export function createContextSlot(): ContextSlotStore {
  let value: ContextSlotValue | null = null;
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

export interface TakeawayContextInput {
  /** the cart adds to a sent token (02b-TK C2-3) */
  adding: { token: number | null } | null;
  /** the token view open over the cart (02b-TK C2-2) */
  token: { token: number | null; name: string | null; paid: boolean } | null;
  /** the pay panel open (02b-TK C3-1): its token once the order is in */
  paying: { ident: string | null; name: string | null } | null;
  /** the name typed in the cart */
  cartName: string | null;
  /** view-customer-contact (R3) */
  seeContact: boolean;
}

const named = (seeContact: boolean, name: string | null | undefined): string | null => {
  const n = (name ?? '').trim();
  return seeContact && n !== '' ? n : null;
};
const tokenText = (n: number | null): string => (n === null ? '—' : String(n));

/** The takeaway screen's slot: the pay panel, else the open token view, else an addition, else the new cart. */
export function takeawayContext(o: TakeawayContextInput): ContextSlotValue {
  if (o.paying !== null)
    return { label: o.paying.ident === null ? t('ctx.new') : t('send.token'), token: o.paying.ident, name: named(o.seeContact, o.paying.name), sub: t('p.title') };
  if (o.token !== null)
    return { label: t('send.token'), token: tokenText(o.token.token), name: named(o.seeContact, o.token.name), sub: t(o.token.paid ? 'q.paid' : 'q.due'), back: true };
  if (o.adding !== null) return { label: t('send.token'), token: tokenText(o.adding.token), name: named(o.seeContact, o.cartName), sub: t('ctx.adding') };
  return { label: t('ctx.new'), token: null, name: named(o.seeContact, o.cartName), sub: t('ctx.token_after') };
}
