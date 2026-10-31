import { formatQuantity, parseQuantity } from '@pos/domain';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../../components/Icon';
import { QuantityInput } from '../../../components/QuantityInput';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { StockRow } from './badges';

// 01a-S11 StockAddSheet (S54 c): on a phone, Add opens a bottom sheet with quick chips in the display
// unit (pieces, kg or L); the quantity is sent in the stock unit (S44), for the row's stock item (01c §8).
const QUICK = ['5', '10', '20', '50'];

export function AddSheet({ row, onAdd, onClose }: { row: StockRow; onAdd: (quantity: number) => void; onClose: () => void }) {
  const { meta, stock } = row;
  const [quantity, setQuantity] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(null);

  useEffect(() => {
    before.current = document.activeElement;
    box.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => {
      if (before.current instanceof HTMLElement) before.current.focus();
    };
  }, []);

  const [afterLead, afterTail] = t('admin_stock.sheet.after').split('{left}');

  const quick = (text: string) => {
    const parsed = parseQuantity(text, meta.stock_unit);
    if (parsed.ok) setQuantity((quantity ?? 0) + parsed.value);
    setPicked(text);
  };

  return (
    <div className="pos-scrim">
      <div
        ref={box}
        className="pos-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('admin_stock.sheet.title')}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <span className="pos-sheet__grip" aria-hidden="true" />
        <div className="pos-section__head">
          <h2 className="pos-sheet__title">{t('admin_stock.sheet.title')}</h2>
          <p className="pos-sheet__sub">
            {fill(t('admin_stock.sheet.now'), { name: meta.name, left: formatQuantity(stock.available, meta.stock_unit) })}
          </p>
        </div>
        <div className="pos-field" data-field="sheet-add">
          <span className="pos-field__label">{t('admin_stock.sheet.how_many')}</span>
          <div className="pos-input-affix pos-sheet__qty">
            <QuantityInput
              compact
              unit={meta.stock_unit}
              value={quantity}
              onChange={(v) => {
                setQuantity(v);
                setPicked(null);
              }}
              label={t('admin_stock.sheet.how_many')}
            />
          </div>
        </div>
        <div className="pos-row">
          {QUICK.map((text) => (
            <button key={text} type="button" className={`pos-chip${picked === text ? ' pos-chip--accent' : ''}`} onClick={() => quick(text)}>
              <span className="pos-ltr">{`+${text}`}</span>
            </button>
          ))}
        </div>
        {quantity !== null && quantity > 0 && (
          <div className="pos-explain">
            <Icon name="check" />
            <span>
              {afterLead}
              <strong className="pos-ltr">{formatQuantity(stock.available + quantity, meta.stock_unit)}</strong>
              {afterTail}
            </span>
          </div>
        )}
        <button
          type="button"
          className="pos-btn pos-btn--primary pos-btn--lg pos-btn--block"
          disabled={quantity === null || quantity <= 0}
          onClick={() => quantity !== null && onAdd(quantity)}
        >
          {fill(t('admin_stock.sheet.add_n'), { n: quantity === null ? '' : formatQuantity(quantity, meta.stock_unit) })}
        </button>
        <button type="button" className="pos-btn pos-btn--block" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
