import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { BillRef, BillView, BillViewSplit, SetSplitsPayload } from './contracts';
import { billingErrorKey } from './errors';
import { billMoney, MONEY_DIR } from './money';
import { partGroups } from './parts';
import { initialColumns, moveUnit, nextSplitNo, openUnits, parseMinor, toPool, unplacedOf, type Column } from './splits';
import './styles';

// 05 v1.0.12 §8 "Splits", §6.5, §3.8 (plan §3.1 task 36; brief §3.3; frames SplitItems, SplitAmount, SplitEqual,
// SplitLocked, SplitInvalid, SplitPortrait): re-plan how the open remainder is paid — by items (tap a line, then a
// split: one unit moves), by amount (shares of the open part's cash total), equally (n 2–20) or as one bill. Closed
// splits show first, locked with their invoice; a split with payments says so (the hub refuses dropping it,
// BILL_HAS_PAYMENTS); ⚠️ G-29 (R-29): a line of an open split with `added_after_close` carries the "new" mark. The
// hub validates and recomputes: Save → `SetSplits`, its `splits` go back to the bill screen (`onSaved`). No amount is
// computed here except the sum of typed shares against the hub's open cash totals.
// 05 v1.0.33 §8 (STAB-5): a split line's parts (`part_of`, one unit each) are one row with a count stepper in every
// split: + takes a part from the not-placed pool, else from the split holding most of the row; − puts one back in the
// pool. The plan still names part ids, each with units 1.

type Mode = 'items' | 'amount' | 'equal' | 'none';
const MODES: Array<{ mode: Mode; key: 'billing.split.items' | 'billing.split.amount' | 'billing.split.equal' | 'billing.split.one' }> = [
  { mode: 'items', key: 'billing.split.items' },
  { mode: 'amount', key: 'billing.split.amount' },
  { mode: 'equal', key: 'billing.split.equal' },
  { mode: 'none', key: 'billing.split.one' },
];

/** The mode the bill's open splits are in now (items when nothing is planned yet). */
function modeOf(bill: BillView): Mode {
  const plan = bill.splits.find((s) => s.state === 'open' && s.plan !== null)?.plan ?? null;
  if (plan === null || 'lines' in plan) return 'items';
  return 'share_minor' in plan ? 'amount' : 'equal';
}

/** A picked-up line: which column it comes from (null = the unplaced pool). */
interface Picked {
  id: string;
  from: number | null;
}

export interface SplitEditorProps {
  bill: BillView;
  /** the ref the bill screen read the bill with (§6 bill_ref; a projected bill has no bill_id) */
  billRef: BillRef;
  onSaved: (splits: BillViewSplit[]) => void;
  onClose: () => void;
}

export function SplitEditor({ bill, billRef, onSaved, onClose }: SplitEditorProps) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const currency = bill.currency.code;
  const money = (minor: number) => billMoney(minor, currency);

  const closed = bill.splits.filter((s) => s.state === 'closed');
  const open = bill.splits.filter((s) => s.state === 'open');
  const remainder = useMemo(() => openUnits(bill), [bill]);
  const nameOf = useMemo(() => new Map(bill.lines.map((l) => [l.order_item_id, l.name] as const)), [bill.lines]);
  const totalOf = useMemo(() => new Map(bill.lines.map((l) => [l.order_item_id, l.units] as const)), [bill.lines]);
  const isNew = useMemo(() => new Set(bill.lines.filter((l) => l.added_after_close).map((l) => l.order_item_id)), [bill.lines]);
  // v1.0.33 (STAB-5): groups of a split line's parts still in the open remainder (line order), and their ids
  const groups = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [k, ids] of partGroups(bill.lines)) {
      const left = ids.filter((id) => remainder.has(id));
      if (left.length > 1) out.set(k, left);
    }
    return out;
  }, [bill.lines, remainder]);
  const grouped = useMemo(() => new Set([...groups.values()].flat()), [groups]);
  const paidOf = useMemo(() => new Map(open.map((s) => [s.split_no, s.payments.reduce((n, p) => n + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0)] as const)), [open]);
  const lastClosed = closed.length === 0 ? null : Math.max(...closed.map((s) => s.split_no));
  const withPayments = open.filter((s) => s.payments.length > 0).length;
  const paidNos = new Set(open.filter((s) => s.payments.length > 0).map((s) => s.split_no));

  const [mode, setMode] = useState<Mode>(() => modeOf(bill));
  const [cols, setCols] = useState<Column[]>(() => initialColumns(bill));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [shares, setShares] = useState<string[]>(() => cols.map(() => ''));
  const [n, setN] = useState(() => Math.max(2, Math.min(20, open.length)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const used = [...closed.map((s) => s.split_no), ...cols.map((c) => c.split_no)];
  const next = nextSplitNo(used);
  const unplaced = unplacedOf(remainder, cols);
  const unplacedCount = [...unplaced.values()].reduce((a, b) => a + b, 0);
  // §3.8 / R-53: a split with payments keeps its number. An items plan names a split only with ≥ 1 line (the hub's
  // SetSplits schema), so an emptied paid split blocks Save here; an empty split with no payment is simply left out.
  const paidEmpty = cols.find((c) => paidNos.has(c.split_no) && c.lines.size === 0)?.split_no ?? null;

  // §3.8 amount: shares of the open remainder's default-class (cash) total, as the hub's open splits show it
  // With one open split its cash total is the open part's; with more, Σ per-split cash totals can differ from the
  // whole by the cash rounding (one rounding per split, B9), so it is only a guide until the hub names the figure
  // (BILL_SPLIT_INVALID shares_sum `expected_minor`), and Save is not held back by it.
  const [hubExpected, setHubExpected] = useState<number | null>(null);
  const exact = hubExpected !== null || open.length <= 1;
  const toShare = hubExpected ?? open.reduce((s, x) => s + x.totals.cash.total_minor, 0);
  const typed = shares.map((x) => parseMinor(x, bill.currency.exponent));
  const typedSum = typed.reduce<number>((s, x) => s + (x ?? 0), 0);
  const left = toShare - typedSum;
  const sharesOk = typed.every((x) => x !== null) && (!exact || left === 0);

  const addSplit = () => {
    if (next === null) return;
    setCols((c) => [...c, { split_no: next, lines: new Map() }]);
    setShares((s) => [...s, '']);
  };
  const dropOn = (split_no: number) => {
    if (picked === null) return;
    setCols((c) => moveUnit(c, picked.id, picked.from, split_no));
    setPicked(null);
  };

  const payload = (): SetSplitsPayload | null => {
    if (mode === 'none') return { bill_ref: billRef, mode: 'none' };
    if (mode === 'equal') return { bill_ref: billRef, mode: 'equal', n };
    if (mode === 'amount') return sharesOk ? { bill_ref: billRef, mode: 'amount', splits: cols.map((c, i) => ({ split_no: c.split_no, share_minor: typed[i] as number })) } : null;
    if (unplacedCount > 0) return null;
    if (paidEmpty !== null) return null;
    if (cols.filter((c) => c.lines.size > 0).length < 2) return null;
    const splits = cols
      .filter((c) => c.lines.size > 0)
      .map((c) => ({ split_no: c.split_no, lines: [...remainder.keys()].filter((id) => c.lines.has(id)).map((id) => ({ order_item_id: id, units: c.lines.get(id) as number })) }));
    return { bill_ref: billRef, mode: 'items', splits };
  };

  const save = async () => {
    const p = payload();
    if (p === null || busy) return;
    setBusy(true);
    setError(null);
    const answer = await api.setSplits(p);
    setBusy(false);
    if (answer.ok) {
      onSaved(answer.data.splits);
      return;
    }
    if (answer.error.kind !== 'api') {
      setError(t('tables.toast.needs_hub'));
      return;
    }
    const d = answer.error.details;
    const item = typeof d['order_item_id'] === 'string' ? (nameOf.get(d['order_item_id']) ?? '') : '';
    const expected = typeof d['expected_minor'] === 'number' ? money(d['expected_minor']) : '';
    const nos = Array.isArray(d['split_nos']) ? d['split_nos'].join(', ') : '';
    if (d['reason'] === 'shares_sum' && typeof d['expected_minor'] === 'number') setHubExpected(d['expected_minor']);
    setError(fill(t(billingErrorKey(answer.error.code, d)), { item, amount: expected, n: nos }));
  };

  const ready = payload() !== null;
  const primaryText =
    mode === 'items' && unplacedCount > 0
      ? fill(t('billing.split.place_first'), { n: String(unplacedCount) })
      : mode === 'items' && paidEmpty !== null
        ? fill(t('billing.split.paid_empty'), { n: String(paidEmpty) })
        : mode === 'items' && cols.filter((c) => c.lines.size > 0).length < 2
        ? t('billing.split.two_needed')
        : mode === 'amount' && !sharesOk
        ? fill(t('billing.split.make_add_up'), { amount: money(toShare) })
        : t('billing.split.save');

  /** + on a group's row in split `to`: a not-placed part first, else the last part of the split holding most of the row */
  const stepIn = (ids: readonly string[], to: number) => {
    const free = ids.find((id) => unplaced.has(id));
    if (free !== undefined) {
      setCols((c) => moveUnit(c, free, null, to));
      return;
    }
    const donor = cols
      .filter((c) => c.split_no !== to)
      .map((c) => ({ c, mine: ids.filter((id) => c.lines.has(id)) }))
      .filter((x) => x.mine.length > 0)
      .sort((a, b) => b.mine.length - a.mine.length || b.c.split_no - a.c.split_no)[0];
    if (donor === undefined) return;
    const id = donor.mine[donor.mine.length - 1]!;
    setCols((c) => moveUnit(c, id, donor.c.split_no, to));
  };
  const stepOut = (ids: readonly string[], from: number) => {
    const mine = ids.filter((id) => cols.find((c) => c.split_no === from)?.lines.has(id) === true);
    const id = mine[mine.length - 1];
    if (id !== undefined) setCols((c) => toPool(c, id, from));
  };
  /** a group's row: name, "n of total" and, in a split, the − / + stepper; in the pool a tap picks one part */
  const groupRow = (key: string, ids: readonly string[], where: number | null) => {
    const here = where === null ? ids.filter((id) => unplaced.has(id)) : ids.filter((id) => cols.find((c) => c.split_no === where)?.lines.has(id) === true);
    const label = (
      <>
        <span>{nameOf.get(ids[0]!) ?? key}</span>
        <span className="q num">{fill(t('billing.split.unit_of'), { units: String(here.length), total: String(ids.length) })}</span>
      </>
    );
    if (where === null) {
      const first = here[0]!;
      const on = picked !== null && picked.id === first && picked.from === null;
      return (
        <button key={`g-${key}`} type="button" className="b5-su err" data-group={key} aria-pressed={on} onClick={() => setPicked(on ? null : { id: first, from: null })}>
          {label}
        </button>
      );
    }
    return (
      <div key={`g-${key}`} className="b5-su" data-group={key}>
        {label}
        <span className="step">
          <button type="button" aria-label={t('cart.less')} disabled={here.length === 0} onClick={() => stepOut(ids, where)}>
            −
          </button>
          <output className="num">{here.length}</output>
          <button type="button" aria-label={t('cart.more')} disabled={here.length === ids.length} onClick={() => stepIn(ids, where)}>
            +
          </button>
        </span>
      </div>
    );
  };

  const unit = (id: string, units: number, from: number | null, opts: { locked?: boolean; err?: boolean; newMark?: boolean } = {}) => {
    const label = (
      <>
        <span>{nameOf.get(id) ?? id}</span>
        <span className="q num">{fill(t('billing.split.unit_of'), { units: String(units), total: String(totalOf.get(id) ?? units) })}</span>
        {opts.newMark === true && lastClosed !== null && <small>{fill(t('billing.split.new_after'), { n: String(lastClosed) })}</small>}
      </>
    );
    const cls = ['b5-su', opts.locked === true ? 'lk' : null, opts.err === true ? 'err' : null].filter((c) => c !== null).join(' ');
    if (opts.locked === true) return <div key={id} className={cls}>{label}</div>;
    const on = picked !== null && picked.id === id && picked.from === from;
    return (
      <button key={id} type="button" className={cls} aria-pressed={on} onClick={() => setPicked(on ? null : { id, from })}>
        {label}
      </button>
    );
  };

  const itemsBody = (
    <>
      <div className="b5-note">{t('billing.split.items_hint')}</div>
      <div className="b5-scols b5-scols--fill">
        {closed.map((s) => (
          <div key={s.split_no} className="b5-scol lockd">
            <div className="b5-scol__h">
              <b>
                <Ico name="lock" /> {fill(t('billing.split_tab'), { n: String(s.split_no) })}
              </b>
              <span>{fill(t('billing.locked_split'), { invoice_ref: s.invoice?.invoice_ref ?? '' })}</span>
            </div>
            {s.plan !== null && 'lines' in s.plan && s.plan.lines.map((l) => unit(l.order_item_id, l.units, null, { locked: true }))}
            <span className="b5-note">{t('billing.split.locked_note')}</span>
          </div>
        ))}
        {unplacedCount > 0 && (
          <div className="b5-scol pool">
            <div className="b5-scol__h">
              <b>{t('billing.split.pool')}</b>
              <span>{fill(t('billing.split.items_count'), { n: String(unplacedCount) })}</span>
            </div>
            {[...unplaced].filter(([id]) => !grouped.has(id)).map(([id, units]) => unit(id, units, null, { err: true, newMark: isNew.has(id) }))}
            {[...groups].filter(([, ids]) => ids.some((id) => unplaced.has(id))).map(([key, ids]) => groupRow(key, ids, null))}
          </div>
        )}
        {cols.map((c) => {
          const paid = paidOf.get(c.split_no) ?? 0;
          const has = (open.find((s) => s.split_no === c.split_no)?.payments.length ?? 0) > 0;
          return (
            <div key={c.split_no} className="b5-scol">
              <button type="button" className="b5-scol__h" onClick={() => dropOn(c.split_no)}>
                <b>{fill(t('billing.split_tab'), { n: String(c.split_no) })}</b>
                <span>{has ? fill(t('billing.split.has_payment'), { amount: money(paid) }) : fill(t('billing.split.lines'), { n: String(c.lines.size) })}</span>
              </button>
              {[...remainder.keys()].filter((id) => c.lines.has(id) && !grouped.has(id)).map((id) => unit(id, c.lines.get(id) as number, c.split_no, { newMark: isNew.has(id) }))}
              {[...groups].map(([key, ids]) => groupRow(key, ids, c.split_no))}
            </div>
          );
        })}
        {next !== null && (
          <button type="button" className="b5-scol add" onClick={addSplit}>
            <span aria-hidden="true">+</span>
            {t('billing.split.add')}
            <span className="b5-note">{t('billing.split.add_hint')}</span>
          </button>
        )}
      </div>
      <div className={unplacedCount > 0 ? 'b5-sum c-warn' : 'b5-sum c-ok'}>
        <Ico name={unplacedCount > 0 ? 'warn' : 'checkc'} />
        <span>{unplacedCount > 0 ? fill(t('errors.BILL_SPLIT_INVALID.units_missing'), { item: nameOf.get([...unplaced.keys()][0] ?? '') ?? '' }) : t('billing.split.all_placed')}</span>
        <b>{unplacedCount > 0 ? fill(t('billing.split.not_placed'), { n: String(unplacedCount) }) : fill(t('billing.split.left'), { n: '0' })}</b>
      </div>
    </>
  );

  const amountBody = (
    <>
      <div className="b5-sum b5-sum--mute">
        <span>{fill(t('billing.split.to_share'), { amount: money(toShare), left: money(left) })}</span>
      </div>
      {cols.map((c, i) => (
        <div key={c.split_no} className="b5-share">
          <b>{fill(t('billing.split_tab'), { n: String(c.split_no) })}</b>
          <label className="b5-fld">
            <span />
            <div className={typed[i] === null && shares[i] !== '' ? 'b5-in err' : 'b5-in'}>
              <small>{currency === 'PKR' ? 'Rs' : currency}</small>
              <input
                inputMode="decimal"
                dir={MONEY_DIR}
                aria-label={fill(t('billing.split_tab'), { n: String(c.split_no) })}
                value={shares[i] ?? ''}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setShares((s) => s.map((x, j) => (j === i ? v : x)));
                }}
              />
            </div>
          </label>
          <span className="b5-note">{t('billing.split.cash')}</span>
        </div>
      ))}
      {next !== null && (
        <button type="button" className="btn b5-start" onClick={addSplit}>
          {t('billing.split.add')}
        </button>
      )}
      <div className="b5-note">{t('billing.split.amount_hint')}</div>
    </>
  );

  const equalBody = (
    <div className="b5-sec">
      <h3>{t('billing.split.how_many')}</h3>
      <div className="b5-stepper">
        <button type="button" className="btn" aria-label={t('billing.split.fewer')} onClick={() => setN((x) => Math.max(2, x - 1))}>
          −
        </button>
        <b className="num">{n}</b>
        <button type="button" className="btn" aria-label={t('billing.split.more')} onClick={() => setN((x) => Math.min(20, x + 1))}>
          +
        </button>
      </div>
      <span className="b5-note">{t('billing.split.equal_hint')}</span>
    </div>
  );

  return (
    <div className={shell.portrait || shell.phone ? 'scrim scrim--sheet' : 'scrim'}>
      <div className="dlg b5-dlg w11" role="dialog" aria-modal="true" aria-label={t('billing.split.title')}>
        <div className="dlg__h">
          <span className="tcode">{bill.identifier}</span>
          <div className="dlg__t">
            <h2>{t('billing.split.title')}</h2>
            <div className="ac__who">{t('billing.split.sub')}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        <div className="b5-seg">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              disabled={m.mode === 'none' && withPayments > 1}
              onClick={() => {
                setMode(m.mode);
                setError(null);
              }}
            >
              {t(m.key)}
            </button>
          ))}
        </div>
        {mode === 'items' && itemsBody}
        {mode === 'amount' && amountBody}
        {mode === 'equal' && equalBody}
        {error !== null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{error}</span>
          </div>
        )}
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" aria-disabled={!ready || busy} onClick={() => void save()}>
            {primaryText}
          </button>
        </div>
      </div>
    </div>
  );
}
