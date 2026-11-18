// 04 §8 (handoff 04 frames VoidAction, Main, VoidDeal, VoidPending): the icons the void screens draw that the shared
// 01d set (alerts/ui.tsx) does not have, with the frames' own paths. Same markup as `Ico`.

type Shape = { d: string } | { c: readonly [number, number, number] };

const ICONS = {
  /** Void (danger), Wastage */
  bin: [{ d: 'M5 7h14' }, { d: 'M9.5 7V4.5h5V7' }, { d: 'M7 7l1 13h8l1-13' }],
  wastage: [{ d: 'M5 7h14' }, { d: 'M9.5 7V4.5h5V7' }, { d: 'M7 7l1 13h8l1-13' }, { d: 'M10 11l4 5' }, { d: 'M14 11l-4 5' }],
  /** Move to ready stock / To stock */
  stock: [{ d: 'M4 7.5h16v12.5H4z' }, { d: 'M4 7.5l2-4h12l2 4' }, { d: 'M12 11v6' }, { d: 'M9 14l3 3 3-3' }],
  meal: [{ d: 'M7 3v8a2 2 0 0 0 2 2v8' }, { d: 'M11 3v8a2 2 0 0 1-2 2' }, { d: 'M9 3v6' }, { d: 'M17 21V3c-2 1.5-3 4-3 7v3h3' }],
  dots: [{ c: [12, 12, 8.5] }, { c: [8.5, 12, 0.6] }, { c: [12, 12, 0.6] }, { c: [15.5, 12, 0.6] }],
  released: [{ d: 'M12 20V8' }, { d: 'M7 12l5-5 5 5' }, { d: 'M5 4h14' }],
  /** PENDING VOID tag (hourglass) */
  hourglass: [{ d: 'M7 3.5h10' }, { d: 'M7 20.5h10' }, { d: 'M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5' }, { d: 'M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5' }],
  below: [{ d: 'M6 9.5l6 6 6-6' }],
} as const satisfies Record<string, readonly Shape[]>;

export type VoidIconName = keyof typeof ICONS;

export function VIco({ name }: { name: VoidIconName }) {
  const shapes: readonly Shape[] = ICONS[name];
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      {shapes.map((s, i) => ('d' in s ? <path key={i} d={s.d} /> : <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} />))}
    </svg>
  );
}
