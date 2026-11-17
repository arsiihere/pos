import type { AlertDetails } from '@pos/events';
import { t, type MessageKey } from '../../i18n';
import { en } from '../../i18n/en';
import { Ico, type IconName } from '../alerts/ui';
import { VIco, type VoidIconName } from './icons';

// 04 §8 Approver card (01d D01, kind void_approval; frames AnswerVoid, AnswerVoidPhone, AnswerVoidPortrait,
// AnswerVoidUrdu; owner Q16, D-3): the 01d fact tiles plus a full-width "Where it goes" (icon + label, from
// `details.disposition`, an i18n key) and "Lines and stage" (one row per `details.lines` entry with its stage chip;
// a deal line shows its most advanced part, Q-16 — the hub sends that state).

const DISPOSITION_ICON: Record<string, VoidIconName> = {
  'void.disposition.moved': 'stock',
  'void.disposition.moved_partly': 'stock',
  'void.disposition.wastage': 'wastage',
  'void.disposition.staff_meal': 'meal',
  'void.disposition.other': 'dots',
};

const STATE: Record<string, { key: MessageKey; tone: string; icon: IconName }> = {
  not_started: { key: 'void.stage.not_started', tone: 'mute', icon: 'clock' },
  cooking: { key: 'void.stage.cooking', tone: 'warn', icon: 'pulse' },
  cooked: { key: 'void.stage.cooked', tone: 'ok', icon: 'checkc' },
  served: { key: 'void.stage.served', tone: 'mute', icon: 'check' },
};

export function VoidFacts({ disposition, lines }: { disposition: AlertDetails['disposition']; lines: AlertDetails['lines'] }) {
  // a key this client does not know is not shown (never a raw key on screen)
  const known = disposition !== undefined && Object.hasOwn(en, disposition) && disposition.startsWith('void.disposition.');
  return (
    <>
      {known && (
        <div className="fact fact--disp fact--wide">
          <span>{t('void.where')}</span>
          <b>
            <VIco name={DISPOSITION_ICON[disposition] ?? 'stock'} />
            {t(disposition as MessageKey)}
          </b>
        </div>
      )}
      {lines !== undefined && lines.length > 0 && (
        <div className="fact fact--wide">
          <span>{t('void.answer.lines')}</span>
          <div className="stl">
            {lines.map((l, i) => {
              const st = STATE[l.state];
              return (
                <span key={i}>
                  <span>
                    <bdi>{l.name}</bdi> <span className="num">×{l.quantity}</span>
                  </span>
                  {st === undefined ? (
                    <span />
                  ) : (
                    <span className={`stg c-${st.tone}`}>
                      <Ico name={st.icon} />
                      {t(st.key)}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
