import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AlertView } from '@pos/events';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { createPinPad, type AnswerInput, type AnswerOutcome, type AnswerSender, type HubLink } from './answer';
import { InPersonPick, type Approver } from './InPerson';
import { inPersonTitle, timeText, titleText, waitingText, alertText } from './labels';
import { PinStep, type PinError } from './PinStep';
import { CloseX, Dialog, FamilyPill, FromLine, Ico, Msg, Ring, Tag, Tags, amountText, tableOf, toneOf, type RowLike } from './ui';

// 01d §8.1, §6.2 (D01–D03, B02–B04; frames Answer, AnswerAccept, AnswerDone, AnswerPortrait, AnswerKiosk,
// AnswerHere, Pin*, InPerson*, AnswerReadOnly, AnswerInformed, AnswerOffline, AnswerOwn, AnswerTaken).
// Money kinds (needs_pin 'always') answer through the PIN step; accept kinds are one tap (method session).
// "Approve here" only when this device raised the request (AD-165). The PIN stays in the pad (answer.ts) and is
// cleared after every response. After success a short "Approved" / "Rejected", then the sheet closes; this seat
// gets no receipt (§3.10).

type Decision = AlertView['answers'] extends readonly (infer D)[] | null | undefined ? D : never;

export interface SheetRow extends RowLike {
  set: AlertView['set'];
  needs_pin?: AlertView['needs_pin'];
  raised_device_id?: string | undefined;
}

export interface Toast {
  text: string;
  sub?: string;
}

/** How long the "Approved" / "Rejected" confirmation shows before the sheet closes. */
export const DONE_MS = 1_500;

type Step =
  | { k: 'detail' }
  | { k: 'pin'; decision: Decision }
  | { k: 'pick' }
  | { k: 'herepin'; who: Approver; decision: Decision }
  | { k: 'done'; decision: Decision };

function decisionsOf(row: SheetRow): { yes: Decision; no: Decision } {
  const answers = row.answers ?? [];
  const accept = answers.includes('accept') || answers.includes('decline');
  return accept ? { yes: 'accept', no: 'decline' } : { yes: 'approve', no: 'reject' };
}

const positive = (d: Decision) => d === 'approve' || d === 'accept';
const LABEL: Record<Decision, string> = {
  approve: 'answer.approve',
  reject: 'answer.reject',
  accept: 'answer.accept',
  decline: 'answer.decline',
};

/** "Void request · T12 · Rs 2,200" (the PIN step's request line and the done line). */
function requestLine(row: SheetRow): ReactNode {
  const table = tableOf(row);
  const amount = row.card?.details?.amount;
  return (
    <>
      {titleText(row)}
      {table !== null && (
        <>
          {' · '}
          <span className="num">{table}</span>
        </>
      )}
      {amount !== undefined && (
        <>
          {' · '}
          <span className="num">{amountText(amount)}</span>
        </>
      )}
    </>
  );
}

function Facts({ row }: { row: SheetRow }) {
  const d = row.card?.details;
  if (d === null || d === undefined) return null;
  return (
    <div className="facts">
      {d.item !== undefined && (
        <div className="fact">
          <span>{t('answer.item')}</span>
          <b>{d.item}</b>
        </div>
      )}
      {d.quantity !== undefined && (
        <div className="fact">
          <span>{t('answer.quantity')}</span>
          <b className="num">×{d.quantity}</b>
        </div>
      )}
      {d.amount !== undefined && (
        <div className="fact fact--amt">
          <span>{t('answer.amount')}</span>
          <b className="num">{amountText(d.amount)}</b>
        </div>
      )}
      {d.reason !== undefined && d.reason !== '' && (
        <div className="fact">
          <span>{t('answer.reason')}</span>
          <b>“{d.reason}”</b>
        </div>
      )}
    </div>
  );
}

export function AnswerSheet({
  row,
  canAnswer,
  deviceId,
  me,
  sender,
  link,
  loadApprovers,
  nowMs,
  utcOffsetMs,
  sheet,
  onClose,
  onToast,
}: {
  row: SheetRow;
  canAnswer: boolean;
  deviceId: string | null;
  me: { staffId: string; name: string };
  sender: AnswerSender;
  link: HubLink;
  loadApprovers: () => Promise<Approver[]>;
  nowMs: number;
  utcOffsetMs: number;
  sheet: boolean;
  onClose: () => void;
  onToast: (toast: Toast) => void;
}) {
  const pad = useMemo(() => createPinPad(link), [link]);
  useEffect(() => () => pad.dispose(), [pad]);
  const up = useSyncExternalStore(link.subscribe, () => link.isUp());
  const [step, setStep] = useState<Step>({ k: 'detail' });
  const [message, setMessage] = useState<string | null>(null);
  const [pinError, setPinError] = useState<PinError | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvers, setApprovers] = useState<Approver[] | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);

  const { yes, no } = decisionsOf(row);
  const money = row.needs_pin === 'always';
  // AD-165: only the device the request was raised on offers the in-person answer
  const here = deviceId !== null && row.raised_device_id !== undefined && row.raised_device_id === deviceId;
  const table = tableOf(row);
  const subLine = `${titleText(row)}${table === null ? '' : ` · ${table}`}`;

  const go = (next: Step) => {
    setMessage(null);
    setPinError(null);
    setLocked(false);
    pad.clear();
    setStep(next);
  };

  function settle(outcome: AnswerOutcome, decision: Decision, where: Step['k']): void {
    if (outcome.ok) {
      setStep({ k: 'done', decision });
      closeTimer.current = setTimeout(onClose, DONE_MS);
      return;
    }
    switch (outcome.code) {
      case 'IN_FLIGHT':
        return; // a double tap; the first answer is still on its way
      case 'REQUEST_NOT_PENDING':
      case 'ALERT_NOT_FOUND':
        onToast({ text: outcome.message, sub: subLine });
        onClose();
        return;
      case 'REQUEST_PIN_REQUIRED':
        go({ k: 'pin', decision });
        return;
      case 'PIN_INVALID':
        setPinError({ text: outcome.message, tone: 'danger', icon: 'warn' });
        return;
      case 'PIN_LOCKED_OUT':
      case 'DEVICE_LOCKED_OUT':
        setPinError({ text: outcome.message, tone: 'danger', icon: 'lock' });
        setLocked(true);
        return;
      case 'SERVICE_UNAVAILABLE':
        setPinError({ text: outcome.message, tone: 'warn', icon: 'sync' });
        return;
      case 'NETWORK':
        return; // B03 shows from the socket state; the PIN is already cleared
      case 'STAFF_NOT_FOUND':
        if (where === 'herepin') {
          go({ k: 'pick' });
          setMessage(outcome.message);
          return;
        }
        break;
      default:
        break;
    }
    if (where === 'pin') {
      // a refusal that is not about the PIN goes back to the request (AnswerOwn: the danger line in the sheet)
      setStep({ k: 'detail' });
      setPinError(null);
    }
    setMessage(outcome.message);
  }

  async function send(input: AnswerInput, where: Step['k']): Promise<void> {
    setBusy(true);
    setMessage(null);
    const outcome = await sender.answer(input, input.method === 'session' ? undefined : pad, { requester_name: row.lock.requester_name ?? null });
    setBusy(false);
    settle(outcome, input.decision, where);
  }

  const choose = (decision: Decision) => {
    if (money) go({ k: 'pin', decision });
    else void send({ alert_id: row.alert_id, decision, method: 'session' }, 'detail');
  };

  const openHere = () => {
    go({ k: 'pick' });
    if (approvers === null) void loadApprovers().then(setApprovers, () => setApprovers([]));
  };

  let body: ReactNode;
  if (step.k === 'done') {
    const ok = positive(step.decision);
    body = (
      <div className="done" role="status">
        <Ring size={110} pct={100} tone={ok ? 'ok' : 'danger'}>
          <Ico name={ok ? 'check' : 'x'} className={`ico--44 ${ok ? 'ico--ok' : 'ico--danger'}`} />
        </Ring>
        <strong id="dt">{t(ok ? 'answer.done_approved' : 'answer.done_rejected')}</strong>
        <span>{requestLine(row)}</span>
      </div>
    );
  } else if (step.k === 'pin') {
    body = (
      <PinStep
        title={fill(t(positive(step.decision) ? 'answer.pin_title_approve' : 'answer.pin_title_reject'), { name: me.name })}
        sub={requestLine(row)}
        pad={pad}
        link={link}
        actionLabel={t(LABEL[step.decision] as 'answer.approve')}
        onSubmit={() => void send({ alert_id: row.alert_id, decision: step.decision, method: 'pin' }, 'pin')}
        error={pinError}
        locked={locked}
        help={pinError === null ? t('answer.pin_not_kept') : null}
        topMessage={message}
        onBack={() => go({ k: 'detail' })}
        onClose={onClose}
      />
    );
  } else if (step.k === 'pick') {
    body = (
      <InPersonPick
        people={approvers}
        sub={requestLine(row)}
        error={message}
        onPick={(who) => go({ k: 'herepin', who, decision: yes })}
        onBack={() => go({ k: 'detail' })}
        onClose={onClose}
      />
    );
  } else if (step.k === 'herepin') {
    const who = step.who;
    body = (
      <PinStep
        title={fill(t('answer.their_pin'), { name: who.display_name })}
        sub={requestLine(row)}
        pad={pad}
        link={link}
        actionLabel={t(LABEL[step.decision] as 'answer.approve')}
        onSubmit={() =>
          void send({ alert_id: row.alert_id, decision: step.decision, method: 'in_person', answerer_staff_id: who.staff_id }, 'herepin')
        }
        error={pinError}
        locked={locked}
        help={fill(t('answer.here_help'), { name: who.display_name })}
        topMessage={message}
        onBack={() => go({ k: 'pick' })}
        onClose={onClose}
      />
    );
  } else {
    const open = row.state !== 'closed';
    const roText = here
      ? fill(t('answer.waiting_for'), { name: t('answer.an_approver') })
      : row.set === 'informed'
        ? fill(t('answer.ro_informed'), { name: t('answer.an_approver') })
        : fill(t('answer.ro_team'), { name: t('answer.an_approver') });
    const off = !up || busy;
    body = (
      <>
        <div className="dlg__h">
          {table !== null && <span className="tcode">{table}</span>}
          <div className="dlg__t">
            <Tags row={row} readOnly={!canAnswer && !here} />
            <h2 id="dt">{titleText(row)}</h2>
            <FromLine row={row} utcOffsetMs={utcOffsetMs}>
              {open && (
                <>
                  {' · '}
                  <Tag tone="danger" icon="clock" className="atag--mid">
                    {waitingText(row.raised_at, nowMs)}
                  </Tag>
                </>
              )}
            </FromLine>
          </div>
          <CloseX onClose={onClose} />
        </div>
        <div className="dlg__body">
          <Facts row={row} />
          {!up ? <Msg tone="danger" icon="wifioff" text={t('answer.error.offline')} /> : message !== null && <Msg tone="danger" icon="warn" text={message} />}
          {!canAnswer && (
            <div className="ro" role="status">
              <Ico name={here ? 'clock' : row.set === 'informed' ? 'info' : 'lock'} />
              <span>{roText}</span>
            </div>
          )}
        </div>
        {canAnswer && open ? (
          <div className="acts">
            <button type="button" className={`btn btn--tone c-${yes === 'accept' ? 'mute' : 'danger'}`} disabled={off} onClick={() => choose(no)}>
              <Ico name="x" />
              {t(LABEL[no] as 'answer.reject')}
            </button>
            <button type="button" className="btn btn--primary" disabled={off} onClick={() => choose(yes)}>
              <Ico name="check" />
              {t(LABEL[yes] as 'answer.approve')}
            </button>
          </div>
        ) : (
          !here && (
            <button type="button" className="btn btn--block btn--lg" onClick={onClose}>
              {t('common.close')}
            </button>
          )
        )}
        {here && open && (
          <button type="button" className="here" disabled={!up} onClick={openHere}>
            <Ico name="userlock" />
            {t('answer.here')}
          </button>
        )}
      </>
    );
  }

  return (
    <Dialog sheet={sheet} labelledBy="dt" onClose={onClose}>
      {body}
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------- D04

const NOTICE_ICON: Record<string, 'userlock' | 'lock' | 'checkc' | 'pulse' | 'receipt' | 'warn'> = {
  answered_on_requester_device: 'userlock',
  pin_use_failed: 'lock',
  request_result: 'checkc',
  test_alert: 'pulse',
  approval_receipt: 'receipt',
  no_approver: 'warn',
};

/**
 * 01d D04 (frames NoticeInPerson, NoticePinFailed, NoticePhone): family mark, the title line, a facts box, and
 * for N01 / N03 the "Not you?" line. Close is the only (primary) button.
 */
export function NoticeSheet({ row, utcOffsetMs, sheet, onClose }: { row: RowLike; utcOffsetMs: number; sheet: boolean; onClose: () => void }) {
  const tone = toneOf(row);
  const display = row.card ?? row.lock;
  const d = row.card?.details ?? null;
  const title = row.kind === 'answered_on_requester_device' ? inPersonTitle(row) : alertText(row);
  const notYou = row.kind === 'answered_on_requester_device' || row.kind === 'pin_use_failed';
  const table = tableOf(row);
  return (
    <Dialog sheet={sheet} labelledBy="dt" onClose={onClose}>
      <div className="dlg__h">
        <span className={`tcode tcode--icon c-${tone}`}>
          <Ico name={row.kind === 'request_result' && row.outcome === 'rejected' ? 'x' : (NOTICE_ICON[row.kind] ?? 'info')} className="ico--30" />
        </span>
        <div className="dlg__t">
          <div className="ac__top">
            <FamilyPill row={row} />
          </div>
          <h2 id="dt">{title}</h2>
        </div>
        <CloseX onClose={onClose} />
      </div>
      <div className="dlg__body">
        <div className="facts">
          <div className="fact">
            <span>{t('answer.fact.when')}</span>
            <b className="num">{timeText(row.raised_at, utcOffsetMs)}</b>
          </div>
          {display.device_name != null && display.device_name !== '' && (
            <div className="fact">
              <span>{t('answer.fact.device')}</span>
              <b>{display.device_name}</b>
            </div>
          )}
          {table !== null && row.kind !== 'request_result' && (
            <div className="fact">
              <span>{t('answer.fact.request')}</span>
              <b>{table}</b>
            </div>
          )}
          {d?.amount !== undefined && (
            <div className="fact">
              <span>{t('answer.amount')}</span>
              <b className="num">{amountText(d.amount)}</b>
            </div>
          )}
          {d?.item !== undefined && (
            <div className="fact">
              <span>{t('answer.item')}</span>
              <b>{d.item}</b>
            </div>
          )}
        </div>
        {notYou && (
          <div className="ro" role="status">
            <Ico name="warn" />
            <span>{t('notice.not_you')}</span>
          </div>
        )}
      </div>
      <button type="button" className="btn btn--block btn--primary btn--lg" onClick={onClose}>
        {t('common.close')}
      </button>
    </Dialog>
  );
}
