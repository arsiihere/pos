// 04 VU2: the icons the Audit frames draw (docs/design/handoff/04/design/Audit*.dc.html), path data copied from them.
// Same markup as the 01d Ico (svg.ico, 24 × 24, aria-hidden); kept here so the 01d icon set is not changed.

type Shape = { d: string } | { c: [number, number, number] } | { r: [number, number, number, number, number] };

const AUDIT_ICONS = {
  list: [{ d: 'M9 6h11' }, { d: 'M9 12h11' }, { d: 'M9 18h11' }, { d: 'M4.5 6v.01' }, { d: 'M4.5 12v.01' }, { d: 'M4.5 18v.01' }],
  cal: [{ r: [3.5, 5, 17, 15.5, 2] }, { d: 'M3.5 10h17' }, { d: 'M8 3v4' }, { d: 'M16 3v4' }],
  user: [{ c: [12, 8.5, 4] }, { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }],
  filter: [{ d: 'M4 5h16l-6 7.5V19l-4 1.5v-8z' }],
  down: [{ d: 'M6 9.5l6 6 6-6' }],
  download: [{ d: 'M12 4v11' }, { d: 'M7 10.5l5 5 5-5' }, { d: 'M5 20h14' }],
  trashx: [{ d: 'M5 7h14' }, { d: 'M9.5 7V4.5h5V7' }, { d: 'M7 7l1 13h8l1-13' }, { d: 'M10 11l4 5' }, { d: 'M14 11l-4 5' }],
  trash: [{ d: 'M5 7h14' }, { d: 'M9.5 7V4.5h5V7' }, { d: 'M7 7l1 13h8l1-13' }],
  box: [{ d: 'M4 7.5h16v12.5H4z' }, { d: 'M4 7.5l2-4h12l2 4' }, { d: 'M12 11v6' }, { d: 'M9 14l3 3 3-3' }],
  shield: [{ d: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z' }, { d: 'M9 12l2 2 4-4' }],
  hourglass: [{ d: 'M7 3.5h10' }, { d: 'M7 20.5h10' }, { d: 'M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5' }, { d: 'M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5' }],
  undo: [{ d: 'M9 14.5L4 9.5l5-5' }, { d: 'M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11' }],
  lock: [{ r: [5, 10.5, 14, 10, 2] }, { d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' }],
  gift: [
    { r: [3.5, 8.5, 17, 4, 1] },
    { d: 'M5 12.5V20h14v-7.5' },
    { d: 'M12 8.5V20' },
    { d: 'M12 8.5C10 4 6.5 5 7.5 7.5c.5 1 2.5 1 4.5 1zM12 8.5c2-4.5 5.5-3.5 4.5-1-.5 1-2.5 1-4.5 1z' },
  ],
  tablet: [{ r: [4, 3, 16, 18, 2] }, { d: 'M11 18h2' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  x: [{ d: 'M6 6l12 12' }, { d: 'M18 6L6 18' }],
  wifioff: [{ d: 'M3 3l18 18' }, { d: 'M8 8a5 5 0 0 0-1 9.9V18h10.5' }, { d: 'M11 6.2A5.5 5.5 0 0 1 17.6 10 4 4 0 0 1 20 17' }],
  retry: [{ d: 'M20 12a8 8 0 1 1-2.3-5.7' }, { d: 'M20 4v5h-5' }],
  search: [{ c: [11, 11, 7] }, { d: 'M20 20l-4-4' }],
  info: [{ c: [12, 12, 8.5] }, { d: 'M12 11v5' }, { d: 'M12 8v.01' }],
  prev: [{ d: 'M15 5l-7 7 7 7' }],
  next: [{ d: 'M9 5l7 7-7 7' }],
  clock: [{ c: [12, 12, 9] }, { d: 'M12 7v5l3.5 2' }],
  dot: [{ c: [12, 12, 3] }],
} satisfies Record<string, Shape[]>;

export type AuditIconName = keyof typeof AUDIT_ICONS;

/** Mirrored on Urdu pages (they point along the reading direction). */
const DIRECTIONAL: ReadonlySet<AuditIconName> = new Set(['prev', 'next']);

export function AIco({ name }: { name: AuditIconName }) {
  const shapes: Shape[] = AUDIT_ICONS[name];
  return (
    <svg className={DIRECTIONAL.has(name) ? 'ico ico--dir' : 'ico'} viewBox="0 0 24 24" aria-hidden="true">
      {shapes.map((s, i) =>
        'd' in s ? (
          <path key={i} d={s.d} />
        ) : 'c' in s ? (
          <circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} />
        ) : (
          <rect key={i} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4]} />
        ),
      )}
    </svg>
  );
}
