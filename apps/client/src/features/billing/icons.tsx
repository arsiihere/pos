// The 05 frames' own icons (handoff 05 design/*.dc.html; 24 × 24, stroke from the kit's .ico). Paths copied as drawn.

const PATHS = {
  bill: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6', 'M9 16h3'],
  dine_in: ['M7 3v7.5a2 2 0 0 0 2 2V21', 'M11 3v7.5a2 2 0 0 1-2 2', 'M9 3v6', 'M17 21V3c-2 1-3.5 3.5-3.5 7s1.5 4 3.5 4'],
  takeaway: ['M5 8h14l-1.2 12.5H6.2z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  parking: ['M5 16.5h14', 'M4 16.5V12l2-5h12l2 5v4.5', 'M4 12h16'],
  printer: ['M7 9V3.5h10V9', 'M7 14h10v6.5H7z'],
  split: ['M12 4v16'],
  wait: ['M7 3.5h10', 'M7 20.5h10', 'M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5', 'M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5'],
  clock: ['M12 7v5l3.5 2'],
  chev: ['M9 5l7 7-7 7'],
  // 05-2 shift frames (ShiftOpen, ShiftClose, ShiftHandover)
  cash: ['M6 9.5v.01', 'M18 14.5v.01'],
  card: ['M2.5 10h19', 'M6.5 14.5h4'],
  wallet: ['M4 7.5h14.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4H17v3.5', 'M16 13.75h.01'],
  drawer: ['M3 10h18', 'M5 14v5.5h14V14', 'M10 7h4'],
  eyeoff: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.9', 'M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9 9 0 0 0 4.4-1.1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  handover: ['M3 12h7', 'M7 8l4 4-4 4'],
  ban: ['M5.6 5.6l12.8 12.8'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
} as const;

/** Extra shapes some icons draw (rects and circles of the frames). */
function Extra({ name }: { name: keyof typeof PATHS }) {
  switch (name) {
    case 'parking':
      return (
        <>
          <circle cx="7.5" cy="16.5" r="2" />
          <circle cx="16.5" cy="16.5" r="2" />
        </>
      );
    case 'printer':
      return <rect x="3.5" y="9" width="17" height="8" rx="2" />;
    case 'split':
      return <rect x="3.5" y="4" width="17" height="16" rx="2" />;
    case 'clock':
    case 'ban':
      return <circle cx="12" cy="12" r="9" />;
    case 'cash':
      return (
        <>
          <rect x="2.5" y="6" width="19" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.6" />
        </>
      );
    case 'card':
      return <rect x="2.5" y="5.5" width="19" height="13" rx="2" />;
    case 'drawer':
      return <rect x="3" y="4" width="18" height="10" rx="2" />;
    case 'handover':
      return <rect x="13" y="5" width="8" height="14" rx="2" />;
    default:
      return null;
  }
}

export type BillIconName = keyof typeof PATHS;

export function BIco({ name, className }: { name: BillIconName; className?: string }) {
  return (
    <svg className={className === undefined ? 'ico' : `ico ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <Extra name={name} />
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
