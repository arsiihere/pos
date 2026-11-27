// 02b-TK L-CLIENT-6b: the hand-off's takeaway icons that alerts/ui's Ico set does not have (frames HeldDrawer,
// TokenDue, TokenLate, PayCash, PayCard, PayDone, ItemSheet, ItemSheetEdit), drawn as the frames draw them (24 × 24
// stroke paths, `.ico` sized by the layer). Same markup as Ico, so every rule for `.ico` applies.

const PATHS = {
  pause: ['M9 5v14', 'M15 5v14'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
  printer: ['M7 9V3h10v6', 'M7 17H4v-8h16v8h-3', 'M7 14h10v7H7z'],
  card: ['M3 6h18v12H3z', 'M3 10h18', 'M7 15h4'],
  cash: ['M3 7h18v10H3z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 10v.01', 'M18 14v.01'],
  bolt: ['M13 3L5 14h6l-1 7 8-11h-6z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  note: ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h5'],
  hand: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V12', 'M11 11.5v-7a1.5 1.5 0 0 1 3 0V12', 'M14 11.5v-5a1.5 1.5 0 0 1 3 0V14', 'M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4 14a1.5 1.5 0 0 1 2.5-1.7L8 14'],
  pot: ['M4 10h16', 'M5 10v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-6', 'M9 6c0-1 1-2 3-2s3 1 3 2'],
  check: ['M5 12l4 4 10-10'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5v.01'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  back: ['M15 6l-6 6 6 6'],
  del: ['M9 6h11v12H9l-6-6z', 'M12 10l4 4', 'M16 10l-4 4'],
} as const;

export type TkIconName = keyof typeof PATHS;

export function TkIco({ name, className }: { name: TkIconName; className?: string }) {
  const cls = ['ico', name === 'back' ? 'ico--dir' : null, className ?? null].filter((c) => c !== null).join(' ');
  return (
    <svg className={cls} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
