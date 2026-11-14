import type { LineDetail } from '@pos/domain';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsMark } from '../store';
import { identifierText } from './Identifier';

// 03b §3.3 (K2; frame 03b-C04): the mark tag. RETURN, BOOST, EXPEDITE and MOVED are danger; PULLED is soft info.
// The KDS is English only in P1 (brief §6.1); the tag text is upper case as the frames draw it.

export type Mark = NonNullable<KdsMark>;

/** marks that put a row on top of Now (§3.3: "mark and return lines on top in red with their reason") */
export const ON_TOP: ReadonlySet<Mark> = new Set(['return', 'boost', 'expedite']);

export function isReturn(mark: KdsMark, d: LineDetail | null): boolean {
  return mark === 'return' || (d?.return_of ?? null) !== null;
}

const ICON: Record<Mark, string> = {
  return: 'M9 14.5L4 9.5l5-5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11',
  boost: 'M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z',
  expedite: 'M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z',
  pulled: 'M12 19V5M6 11l6-6 6 6',
  moved: 'M12 7v5l3.5 2',
};

/** `extra`: the part after "·" ("new time 1:44 PM", "in 3:40") */
export function MarkTag({ mark, extra }: { mark: Mark; extra?: string }) {
  const word = t(`kds.mark.${mark}`).toUpperCase();
  return (
    <span className={mark === 'pulled' ? 'kmk c-info soft' : 'kmk c-danger'}>
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        {mark === 'moved' && <circle cx="12" cy="12" r="9" />}
        <path d={ICON[mark]} />
      </svg>
      {extra === undefined ? word : `${word} · ${extra}`}
    </span>
  );
}

/** "Remake · was T7 Chicken Karahi Half" (frame KdsKarahi) */
export function returnWhy(d: LineDetail): string | null {
  const r = d.return_of;
  if (r === null) return null;
  const mode = t(r.mode === 'fix' ? 'kds.mark.fix' : 'kds.mark.remake');
  return `${mode} · ${fill(t('kds.mark.was'), { identifier: identifierText(r.identifier), item: r.item_name })}`;
}
