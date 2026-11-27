import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { CloseX, Dialog } from '../../../alerts/ui';
import { TkIco } from '../takeaway/icons';
import { MONEY_DIR, money } from '../money';
import type { AvailabilityInputs } from '../live/availability';
import { itemAvailability } from '../live/availability';
import type { BranchConfig } from '@pos/events';

// ⚠️ 02b-TK L-CLIENT-6b item 3 (frames ItemSheet, ItemSheetEdit, ItemSheetKg, ItemSheetUrdu, DealSheet; MAPPING TK-D03,
// TK-D04): the parts the takeaway item and deal sheets share — the header (photo, name, "Ready by … · station"), the
// section head with its rule chip, an add-on card with its stepper, the inline kitchen note and the footer (Qty, the
// primary with the price and Enter). Times and money stay LTR inside Urdu (LRI … PDI).

/** A time or an amount inside a sentence: an LTR isolate, so "7:02 AM" never reads "AM 7:02" in Urdu. */
export const ltr = (s: string): string => `⁦${s}⁩`;

export function monogram(name: string): string {
  const words = name.replace(/[—·-].*$/, '').trim().split(/\s+/).filter((w) => w !== '');
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** "Ready by 1:42 PM · Karahi station busy": the wait the tile shows as a clock time, and the station's band. */
export function readyLine(config: BranchConfig, inputs: AvailabilityInputs | null, item_id: string): string | null {
  if (inputs === null) return null;
  const item = config.items.find((i) => i.item_id === item_id);
  if (item === undefined) return null;
  const state = itemAvailability(item_id, inputs).state;
  const ready = state.kind === 'now' ? t('is.ready_now') : state.kind === 'about' ? fill(t('is.ready_by'), { t: ltr(timeText(inputs.nowMs + state.minutes * 60_000, inputs.utcOffsetMs)) }) : null;
  if (ready === null) return null;
  const band = inputs.stationBand?.(item.station_id) ?? null;
  const station = config.stations.find((s) => s.station_id === item.station_id)?.name ?? null;
  if (station === null || band === null || band === 'green' || item.is_ready_item) return ready;
  return `${ready} · ${fill(t(band === 'red' ? 'is.station_full' : 'is.station_busy'), { station })}`;
}

/** The minutes the tile shows for an item ("22 min" / "Now"), or null. */
export function minutesOf(inputs: AvailabilityInputs | null, item_id: string, cook_ms: number): string | null {
  if (inputs === null) return fill(t('is.min'), { n: String(Math.max(1, Math.round(cook_ms / 60_000))) });
  const state = itemAvailability(item_id, inputs).state;
  if (state.kind === 'now') return t('menu.now');
  if (state.kind === 'about') return fill(t('is.min'), { n: String(state.minutes) });
  return null;
}

export function TkSheetHead({ id, name, sub, onClose }: { id: string; name: string; sub: string | null; onClose(): void }) {
  return (
    <div className="tk-sheet__h">
      <span className="tk-sheet__ph" aria-hidden="true">
        {monogram(name)}
      </span>
      <div className="tk-sheet__t">
        <h2 id={id}>
          <bdi>{name}</bdi>
        </h2>
        {sub !== null && <small>{sub}</small>}
      </div>
      <CloseX onClose={onClose} />
    </div>
  );
}

export function TkSecHead({ title, rule, tone, aside }: { title: string; rule?: string | null; tone?: 'ok' | 'need' | null; aside?: ReactNode }) {
  return (
    <div className="tk-sec-h">
      <b>{title}</b>
      {rule != null && <span className={`tk-chip ${tone === 'ok' ? 'tk-chip--ok' : tone === 'need' ? 'tk-chip--brand' : ''}`}>{tone === 'ok' && <TkIco name="check" />}{rule}</span>}
      {aside}
    </div>
  );
}

/** One add-on as the frame's card: name, "+ Rs 70 each", − n + (or off with its reason). */
export function TkAddon(p: {
  name: string;
  price_minor: number;
  q: number;
  more: boolean;
  off?: string | null;
  warn?: string | null;
  onStep(delta: 1 | -1): void;
}) {
  if (p.off != null && p.q === 0)
    return (
      <div className="tk-opt tk-opt--off" role="group" aria-label={p.name} aria-disabled="true">
        <div className="tk-opt__n">
          <b><bdi>{p.name}</bdi></b>
          <small>{t('is.turned_off')}</small>
        </div>
        <span className="tk-chip tk-chip--danger">{p.off.charAt(0).toUpperCase() + p.off.slice(1)}</span>
      </div>
    );
  return (
    <div className={p.q > 0 ? 'tk-opt is-on' : 'tk-opt'} role="group" aria-label={p.name}>
      <div className="tk-opt__n">
        <b><bdi>{p.name}</bdi></b>
        <small>
          {p.warn != null ? (
            <span className="c-warn">{p.warn}</span>
          ) : (
            <>
              +{' '}
              <span dir={MONEY_DIR}>{money(p.price_minor)}</span> {t('is.each')}
            </>
          )}
        </small>
      </div>
      <span className="tk-step tk-step--sm">
        <button type="button" aria-label={fill(t('opt.less'), { option: p.name })} disabled={p.q === 0} onClick={() => p.onStep(-1)}>
          <TkIco name="minus" />
        </button>
        <output className="num">{p.q}</output>
        <button type="button" aria-label={fill(t('opt.more'), { option: p.name })} disabled={!p.more} onClick={() => p.onStep(1)}>
          <TkIco name="plus" />
        </button>
      </span>
    </div>
  );
}

/** The inline kitchen note (≤ 80): the row with "Add note"; the field in place once tapped or set. */
export function TkNote({ value, max, onChange }: { value: string | undefined; max: number; onChange(v: string | undefined): void }) {
  return (
    <label className={value === undefined ? 'tk-knote' : 'tk-knote is-set'}>
      <TkIco name="note" />
      <input
        type="text"
        name="kitchen_note"
        dir="auto"
        maxLength={max}
        placeholder={fill(t('is.note_ph'), { n: String(max) })}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {value === undefined && (
        <span className="tk-btn tk-knote__add" aria-hidden="true">
          <TkIco name="plus" />
          {t('c.note_add')}
        </span>
      )}
    </label>
  );
}

/** The footer: Qty − n + (or the weight), a red trash on the left when editing, the primary with its price + Enter. */
export function TkSheetFoot(p: {
  qty: ReactNode;
  onRemove?: (() => void) | undefined;
  label: string;
  price: string | null;
  ok: boolean;
  onPrimary(): void;
}) {
  return (
    <div className="tk-sheet__f">
      {p.onRemove !== undefined && (
        <button type="button" className="tk-btn tk-sheet__trash" aria-label={t('cart.remove')} onClick={p.onRemove}>
          <TkIco name="trash" />
        </button>
      )}
      {p.qty}
      <button type="button" className="tk-btn tk-btn--xl tk-btn--primary tk-sheet__go" aria-disabled={!p.ok} onClick={() => p.ok && p.onPrimary()}>
        <span>{p.label}</span>
        {p.price !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span dir={MONEY_DIR}>{p.price}</span>
          </>
        )}
        {p.ok && (
          <span className="tk-kbd" dir="ltr">
            Enter
          </span>
        )}
      </button>
    </div>
  );
}

export function TkQty({ value, min = 1, max, onChange }: { value: number; min?: number; max?: number | null; onChange(n: number): void }) {
  return (
    <span className="tk-sheet__qty">
      <small>{t('is.qty')}</small>
      <span className="tk-step" role="group" aria-label={t('cart.quantity')}>
        <button type="button" aria-label={t('cart.less')} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
          <TkIco name="minus" />
        </button>
        <output className="num">{value}</output>
        <button type="button" aria-label={t('cart.more')} disabled={max != null && value >= max} onClick={() => onChange(value + 1)}>
          <TkIco name="plus" />
        </button>
      </span>
    </span>
  );
}

/**
 * The sheet itself (the Dialog: focus trap, Escape) with the frames' "Enter" on the primary: Enter adds (or saves)
 * unless a text field or a button has the focus (a button's own Enter stays that button's).
 */
export function TkSheet({ onEnter, sheet, onClose, labelledBy = 'opt-t', children }: { onEnter(): void; sheet: boolean; onClose(): void; labelledBy?: string; children: ReactNode }) {
  const enter = useRef(onEnter);
  enter.current = onEnter;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const at = document.activeElement;
      if (at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement) return;
      if (at instanceof HTMLButtonElement && !at.classList.contains('dlg__x')) return;
      e.preventDefault();
      enter.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Dialog sheet={sheet} labelledBy={labelledBy} onClose={onClose} className="dlg--w tk-sheet">
      {children}
    </Dialog>
  );
}
