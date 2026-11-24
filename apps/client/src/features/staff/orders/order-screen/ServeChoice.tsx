import type { ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import type { ServeMode } from '../contracts';

// 02b-TK A2 item 5b (frame ServeChoice; MAPPING TK-S02 `.tk-serve`; CHANGES §2 plain cashier words): on a takeaway with
// something ready now and something from the kitchen, one plain question in the footer in place of the Together / As
// ready switch — "Paye is ready now. Give it now?" with "All together 1:42 PM" (serve_mode 'sync') and "Paye now,
// rest 1:42 PM" ('immediate'). It sets the same order choice the switch set (02b v1.0.21 §8, STAB-5): no new payload;
// a line's own override in its edit sheet still wins. `mixed` (the lines' menu settings differ): neither is pressed.

/** A text with `{t}` replaced by the time, set LTR (numbers stay LTR in Urdu, CHANGES §2). */
function withTime(text: string, time: string): ReactNode {
  const [before, after = ''] = text.split('{t}');
  return (
    <>
      {before}
      <span className="time" dir="ltr">
        {time}
      </span>
      {after}
    </>
  );
}

export function ServeChoice({ now, ready_by, utcOffsetMs, state, onSet }: { now: string[]; ready_by: number | null; utcOffsetMs: number; state: ServeMode | 'mixed'; onSet(mode: ServeMode): void }) {
  const item = now.join(' + ');
  const question = fill(t(now.length > 1 ? 'c.serve_q_many' : 'c.serve_q'), { item });
  const time = ready_by === null ? '—' : timeText(ready_by, utcOffsetMs);
  return (
    <div className="tk-serve" role="group" aria-label={question}>
      <b>{question}</b>
      <div className="tk-pick">
        <button type="button" className={state === 'sync' ? 'is-sel' : undefined} aria-pressed={state === 'sync'} onClick={() => onSet('sync')}>
          {withTime(t('c.serve_together'), time)}
        </button>
        <button type="button" className={state === 'immediate' ? 'is-sel' : undefined} aria-pressed={state === 'immediate'} onClick={() => onSet('immediate')}>
          {withTime(fill(t('c.serve_now'), { item }), time)}
        </button>
      </div>
    </div>
  );
}
