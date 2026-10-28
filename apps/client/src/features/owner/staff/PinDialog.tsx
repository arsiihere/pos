import { useState } from 'react';
import type { ChangedVersions, CloudAdmin, Staff } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { PinPad } from '../../../components/PinPad';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { errorText } from '../form';
import { joinNames } from './people';

// 01b §8 D01, §6.3: set or reset a PIN. Laptop: two masked fields. Phone: the kit PIN pad twice, handed to
// the person. The PIN lives only in this component's state and is cleared after the request, whatever its
// answer; a failure changes nothing (the old PIN still works).
const PIN = /^[0-9]{4,6}$/;

type Outcome = 'saved' | 'offline' | 'left' | { error: string } | null;

export function PinDialog({
  api,
  staff,
  branchNames,
  onSaved,
  onClose,
}: {
  api: CloudAdmin;
  staff: Staff;
  branchNames: readonly string[];
  onSaved: (staff: Staff, changed: ChangedVersions) => void;
  onClose: () => void;
}) {
  const phone = usePhone();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [fieldError, setFieldError] = useState<'short' | 'mismatch' | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [firstPin] = useState(!staff.has_pin);
  const name = staff.display_name;
  const branches = joinNames(branchNames);

  async function send(value: string) {
    setBusy(true);
    const result = await api.setPin(staff.staff_id, value);
    setPin('');
    setAgain('');
    setBusy(false);
    if (result.ok) {
      setOutcome('saved');
      onSaved(result.data.staff, result.data.changed_versions);
    } else if (result.error.kind === 'network') {
      setOutcome('offline');
    } else if (result.error.kind === 'api' && result.error.code === 'STAFF_NOT_FOUND') {
      setOutcome('left');
    } else {
      setOutcome({ error: errorText(result.error) ?? '' });
    }
  }

  function save() {
    if (!PIN.test(pin)) {
      setFieldError('short');
      return;
    }
    if (again !== pin) {
      setFieldError('mismatch');
      setAgain('');
      return;
    }
    setFieldError(null);
    void send(pin);
  }

  if (phone) {
    return (
      <PhoneHandOver name={name} branches={branches} outcome={outcome} busy={busy} onSend={(value) => void send(value)} onRetry={() => setOutcome(null)} onClose={onClose} />
    );
  }

  if (outcome === 'saved') {
    return (
      <Dialog
        title={fill(t('staff.pin.saved_title'), { name })}
        onClose={onClose}
        footer={
          <button type="button" className="pos-btn pos-btn--primary" onClick={onClose}>
            {t('staff.pin.done')}
          </button>
        }
      >
        <p className="pos-dialog__body">{fill(t('staff.pin.saved_body'), { name, branches })}</p>
        {firstPin && (
          <div className="pos-explain">
            <span>{fill(t('staff.pin.first'), { branches })}</span>
          </div>
        )}
      </Dialog>
    );
  }

  if (outcome === 'left') {
    return (
      <Dialog
        title={fill(t('staff.pin.title'), { name })}
        onClose={onClose}
        footer={
          <button type="button" className="pos-btn pos-btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        }
      >
        <Banner tone="danger" text={fill(t('staff.pin.left'), { name })} detail={t('staff.pin.left_body')} />
      </Dialog>
    );
  }

  return (
    <Dialog
      title={fill(t('staff.pin.title'), { name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <BusyButton primary busy={busy} onClick={save}>
            {busy ? t('staff.pin.saving') : outcome === 'offline' ? t('staff.pin.try_again') : t('staff.pin.save')}
          </BusyButton>
        </>
      }
    >
      {outcome === 'offline' && <Banner tone="warn" text={t('staff.pin.offline')} detail={fill(t('staff.pin.offline_body'), { name })} />}
      {outcome !== null && typeof outcome === 'object' && <Banner tone="danger" text={outcome.error} />}
      <div className="pos-grid">
        <label className={`pos-field${fieldError === 'short' ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('staff.pin.new')}</span>
          <input
            className="pos-input pos-input--code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            name="pin"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          {fieldError === 'short' ? (
            <span className="pos-field__error">{t('staff.pin.short')}</span>
          ) : (
            <span className="pos-field__help">{t('staff.pin.help')}</span>
          )}
        </label>
        <label className={`pos-field${fieldError === 'mismatch' ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('staff.pin.again')}</span>
          <input
            className="pos-input pos-input--code"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            name="pin_again"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {fieldError === 'mismatch' && <span className="pos-field__error">{t('staff.pin.mismatch')}</span>}
        </label>
      </div>
      <div className="pos-explain">
        <span>{fill(t('staff.pin.signs_out'), { name })}</span>
      </div>
    </Dialog>
  );
}

// D01 phone: step 1 type, step 2 type again; a mismatch starts over. The first PIN is held only until the
// second is typed.
function PhoneHandOver({
  name,
  branches,
  outcome,
  busy,
  onSend,
  onRetry,
  onClose,
}: {
  name: string;
  branches: string;
  outcome: Outcome;
  busy: boolean;
  onSend: (pin: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<'short' | 'mismatch' | null>(null);

  if (outcome === 'saved' || outcome === 'offline') {
    const saved = outcome === 'saved';
    return (
      <div className="pos-overlay">
        <main className={`pos-screen pos-screen--${saved ? 'ok' : 'warn'}`}>
          <h1 className="pos-screen__title">{saved ? fill(t('staff.pin.saved_title'), { name }) : t('staff.pin.offline')}</h1>
          <p className="pos-screen__body">
            {saved ? fill(t('staff.pin.phone_saved_body'), { name, branches }) : fill(t('staff.pin.offline_body'), { name })}
          </p>
          <div className="pos-row">
            <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" onClick={saved ? onClose : onRetry}>
              {saved ? t('staff.pin.done') : t('staff.pin.try_again')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  function submit(value: string) {
    if (!PIN.test(value)) {
      setError('short');
      return;
    }
    if (first === null) {
      setError(null);
      setFirst(value);
      return;
    }
    setFirst(null);
    if (value !== first) {
      setError('mismatch');
      return;
    }
    setError(null);
    onSend(value);
  }

  const step = first === null ? 1 : 2;
  return (
    <div className="pos-overlay">
      <main className="pos-content">
        {error === 'mismatch' ? (
          <Banner tone="danger" text={t('staff.pin.mismatch')} detail={fill(t('staff.pin.hand_back'), { name })} />
        ) : outcome !== null && typeof outcome === 'object' ? (
          <Banner tone="danger" text={outcome.error} />
        ) : (
          <Banner tone="info" text={fill(t('staff.pin.hand_over'), { name })} detail={t('staff.pin.hand_over_body')} />
        )}
        <div>
          <span className={typeClass('caption')}>{fill(t('staff.pin.step'), { n: String(step) })}</span>
          <p className="label">{step === 1 ? t('staff.pin.type_new') : t('staff.pin.again')}</p>
          {error === 'short' && <p className="pos-field__error">{t('staff.pin.short')}</p>}
          <PinPad key={step} disabled={busy} onSubmit={submit} />
        </div>
        <p className={typeClass('caption')}>{t('staff.pin.phone_signs_out')}</p>
        <button type="button" className="pos-btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </main>
    </div>
  );
}
