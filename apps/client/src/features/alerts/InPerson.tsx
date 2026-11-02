import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { CloseX, Ico, Msg, initial } from './ui';

// 01d D03 (frames InPersonPick, InPersonError): "Who is approving?" with the approver tiles from the device
// roster (people without a PIN are never on it, 01b B3), then that person's PIN (PinStep, in AnswerSheet).
// Shown only on the raising device (AD-165); the hub answers in_person_elsewhere anywhere else.

export interface Approver {
  staff_id: string;
  display_name: string;
}

export function InPersonPick({
  people,
  sub,
  error,
  onPick,
  onBack,
  onClose,
}: {
  people: readonly Approver[] | null;
  sub: ReactNode;
  error: string | null;
  onPick: (person: Approver) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="dlg__h">
        <button type="button" className="btn" onClick={onBack}>
          <Ico name="back" />
          {t('answer.back')}
        </button>
        <span className="grow" />
        <CloseX onClose={onClose} />
      </div>
      {error !== null && <Msg tone="danger" icon="warn" text={error} />}
      <div className="pin">
        <h2 className="pin__t" id="dt">
          {t('answer.who')}
        </h2>
        <p className="pin__s">{sub}</p>
      </div>
      <div className="dlg__body">
        {people === null ? (
          <div className="who who--3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="sk sk--tile" />
            ))}
          </div>
        ) : (
          <div className="who who--3">
            {people.map((p) => (
              <button key={p.staff_id} type="button" className="who__t" onClick={() => onPick(p)}>
                <span className="av">{initial(p.display_name)}</span>
                <span>
                  <b>{p.display_name}</b>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
