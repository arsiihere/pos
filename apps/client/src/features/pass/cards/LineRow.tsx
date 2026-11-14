import type { ReactNode } from 'react';
import { t } from '../../../i18n';
import { lineTags } from '../../kds/slots';
import type { PointLine } from '../contracts';

// 03b v1.0.8 §3.4 (P2; frame 03b-C11 in PassCards / Pass): one Pass line — units x item, the slot tags (03c `printed`)
// and the stage chip (waiting / cooking / done / handed over: icon + word + colour), the options and kitchen note
// under it, then the line's own actions (P3: Start / Done on a screenless station). A handed-over line is muted.

const ICON: Record<'waiting' | 'cooking' | 'done' | 'handed_over', ReactNode> = {
  waiting: (
    <>
      <path d="M7 3.5h10" />
      <path d="M7 20.5h10" />
      <path d="M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5" />
      <path d="M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5" />
    </>
  ),
  cooking: <path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 2.8-5.6 4-8.8 2.2 1.4 2.8 3.6 2.6 5.4 1.2-.4 2-1.6 2.2-3 2 1.8 2.2 4.2 2.2 6.4C16.5 18.4 15 21 12 21z" />,
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  handed_over: (
    <>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M15 12h6" />
      <path d="M18.5 9l3 3-3 3" />
    </>
  ),
};
const TONE = { waiting: 'c-mute', cooking: 'c-warn', done: 'c-ok', handed_over: 'c-info' } as const;

export function stageOf(line: PointLine): keyof typeof TONE {
  if (line.handed_over) return 'handed_over';
  return line.stage === 'added' ? 'waiting' : line.stage;
}

export function LineRow({ line, actions }: { line: PointLine; actions?: ReactNode }) {
  const stage = stageOf(line);
  const tags = lineTags(line);
  const extra = [...line.options, ...(line.kitchen_note === null ? [] : [`“${line.kitchen_note}”`])];
  return (
    <div className={line.handed_over ? 'pl ho' : 'pl'} data-id={line.order_item_id}>
      <span className="pl__t">
        <span className="q">{line.units} x</span>
        {line.item_name}
      </span>
      <span className="row">
        {tags.map((tag) => (
          <span key={tag.key} className="ptag">
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 9V3.5h10V9" />
              <rect x="3.5" y="9" width="17" height="8" rx="2" />
              <path d="M7 14.5h10V21H7z" />
            </svg>
            {tag.label}
          </span>
        ))}
        <span className={`stg ${TONE[stage]}`}>
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            {ICON[stage]}
          </svg>
          {t(`pass.stage.${stage}`)}
        </span>
      </span>
      {extra.length > 0 && <span className="pl__o">{extra.join(' · ')}</span>}
      {actions}
    </div>
  );
}
