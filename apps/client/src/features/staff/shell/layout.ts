// The staff shell's layout queries, one source (StaffApp's useMedia, and the deep-link table place, dl cp5).
// 01d §8.1, 02a §8: a phone is ≤ 760 px wide; a tablet in portrait gets the bottom sheets too.

export const PHONE_QUERY = '(max-width: 760px)';
export const PORTRAIT_QUERY = '(orientation: portrait) and (min-width: 761px)';

const matches = (q: string): boolean => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

/** The table sheet is a bottom sheet (phone, or a tablet in portrait), not the side panel. */
export const bottomSheetLayout = (): boolean => matches(PHONE_QUERY) || matches(PORTRAIT_QUERY);
