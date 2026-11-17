import { useEffect, useState, useSyncExternalStore } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { SeatingLine } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { compOffered, Sheet, type LineOrder } from '../view/LineActions';
import { CompSheet } from './CompSheet';
import { pendingCompsOf, type CompItSource } from './pending-comps';

// 02b v1.0.11 §8 Table view E-7 (frames CompItPrompt, CompItYes, CompItNo): a dish sent again as a new item ("Send it
// as a new item") bills again; once its round is sent (a 2xx — a queued round waits for its ItemAdded frame) the view
// asks "Comp the new Chicken Karahi?". No → "Kept on the bill"; Yes → Comp with the item and units filled in, "Pick a
// reason" until one is chosen (the usual CompLine, approval per grant). Asked once per line.

export interface CompItPromptProps {
  seating_id: string;
  /** the seating's orders as the view shows them (the new line is found here once the view has read it) */
  orders: LineOrder[];
  /** 26d `onCompItSent` (27a3 binds it) */
  source: CompItSource;
  onChanged(): void;
}

export function CompItPrompt({ seating_id, orders, source, onChanged }: CompItPromptProps) {
  const shell = useShell();
  const store = pendingCompsOf(shell);
  // the store keeps the subscription for the page's life: a round sent while no table view is open is not lost
  useEffect(() => store.bindSource(source), [source, store]);
  useSyncExternalStore(store.subscribe, store.version);
  const [comping, setComping] = useState<{ line: SeatingLine; order: LineOrder } | null>(null);

  if (comping !== null) {
    return (
      <CompSheet
        line={comping.line}
        order={comping.order}
        units={comping.line.live_units - comping.line.comped_units}
        onClose={() => setComping(null)}
        onDone={() => {
          setComping(null);
          onChanged();
        }}
        onChanged={onChanged}
      />
    );
  }
  // the first due comp-it line the view already shows (a sent round is read by the view's refetch)
  let found: { line: SeatingLine; order: LineOrder } | null = null;
  for (const c of store.compItsFor(seating_id)) {
    const order = orders.find((o) => o.order_id === c.order_id);
    const line = order?.lines.find((l) => l.order_item_id === c.order_item_id && l.live_units > 0);
    // asked only when Comp could be given now (grant, online, not billed, no open request on the line)
    if (order !== undefined && line !== undefined && compOffered(shell, line, order)) {
      found = { line, order };
      break;
    }
  }
  if (found === null) return null;
  const { line, order } = found;
  const no = () => {
    store.compItDone(line.order_item_id);
    shell.toasts.show({ text: t('compit.kept'), sub: t('compit.kept_sub'), tone: 'info' });
  };
  const yes = () => {
    store.compItDone(line.order_item_id);
    setComping({ line, order });
  };
  return (
    <Sheet
      title={fill(t('compit.title'), { item: line.name })}
      sub={t('compit.body')}
      ident={order.ident}
      onClose={no}
      actions={
        <>
          <button type="button" className="btn" onClick={no}>
            {t('compit.no')}
          </button>
          <button type="button" className="btn btn--primary" onClick={yes}>
            <Ico name="checkc" />
            {t('compit.yes')}
          </button>
        </>
      }
    >
      <div className="qline">
        <b>
          {line.live_units}× {line.name}
        </b>
        <span className="pv">
          <strong className="num" dir={MONEY_DIR}>
            {money(line.billed_minor)}
          </strong>
        </span>
      </div>
      <p className="dlg__line">{t('compit.yes_hint')}</p>
    </Sheet>
  );
}
