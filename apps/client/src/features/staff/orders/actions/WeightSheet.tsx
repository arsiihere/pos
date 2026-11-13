import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { LineView } from '../contracts';
import { money } from '../money';
import { showOrderError, Sheet } from '../view/LineActions';

// 02b v1.0.11 §3.6, §6.3 (frame 02b-D34 EnterWeight): the weight in kg on a number pad, the live total, then
// SetLineWeight with the quantity in grams (ml) — 50 to 50 000 in steps of 50 (S59). No price is computed here: the
// line's money comes from its ItemAdded copy on the hub (01c M7), so the sheet shows the hub's saved `line_total_minor`.

export const WEIGHT_MIN_G = 50;
export const WEIGHT_MAX_G = 50_000;
export const WEIGHT_STEP_G = 50;

/** grams for a typed kg text ("1.25" → 1250), or null when it is not a valid 50 g step in 50 g – 50 kg. */
export function gramsOf(text: string): number | null {
  if (!/^\d{1,2}(\.\d{0,3})?$/.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  const g = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
  if (g < WEIGHT_MIN_G || g > WEIGHT_MAX_G || g % WEIGHT_STEP_G !== 0) return null;
  return g;
}

const kgText = (grams: number) => String(grams / 1000);

export interface WeightSheetProps {
  line: LineView;
  ident: string;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;

export function WeightSheet({ line, ident, onClose, onDone, onChanged }: WeightSheetProps) {
  const shell = useShell();
  const [text, setText] = useState(line.quantity === null ? '' : kgText(line.quantity));
  const [busy, setBusy] = useState(false);
  const unit = line.sale_unit === 'ml' ? t('line.unit_l') : t('quantity.kg');
  const grams = gramsOf(text);
  const press = (k: (typeof KEYS)[number]) =>
    setText((cur) => {
      if (k === '.' && cur.includes('.')) return cur;
      const next = cur === '' && k === '.' ? '0.' : cur + k;
      return /^\d{1,2}(\.\d{0,3})?$/.test(next) ? next : cur;
    });
  const save = async () => {
    if (grams === null || busy) return;
    setBusy(true);
    const answer = await shell.orders.setLineWeight({ order_item_id: line.order_item_id, quantity: grams });
    setBusy(false);
    if (!answer.ok) {
      showOrderError(shell, answer.error, onChanged);
      return;
    }
    shell.toasts.show({ text: fill(t('weight.saved'), { amount: money(answer.data.line_total_minor) }) });
    onDone();
  };
  return (
    <Sheet
      title={fill(t('weight.title'), { item: line.name })}
      sub={t('weight.sub')}
      ident={ident}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={grams === null || busy} onClick={() => void save()}>
            <Ico name="check" />
            {t('weight.save')}
          </button>
        </>
      }
    >
      <div className="inp inp--big" dir="ltr" aria-live="polite">
        <output className="num">{text === '' ? '0' : text}</output> <span className="muted">{unit}</span>
      </div>
      <div className="wpad">
        {KEYS.map((k) => (
          <button key={k} type="button" className="btn" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="btn btn--fn" onClick={() => setText((cur) => cur.slice(0, -1))}>
          {t('pin.delete')}
        </button>
      </div>
    </Sheet>
  );
}
