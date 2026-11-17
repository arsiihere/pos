import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { initial } from '../alerts/ui';
import type { AuditApi, AuditStaffRow } from './api';
import { dayStart, daysRange, DAY_MS, dayCount, hubDate, hubMidnight, longDayText, MAX_DAYS, presetOf, presetRange, type DayRange, type Preset } from './days';
import { AIco } from './icons';
import { actionMeta, actionText, AUDIT_GROUPS, groupActions, groupText } from './labels';

// 04 §8 filter popovers (VU2b): Staff (04-C04, frame AuditStaff) from §6.5b audit-staff, Everyone first, a person no
// longer in the directory marked "left", one person matched as actor or approver; Actions (04-C05, frame AuditActions)
// grouped ticks with a group All, Clear / Show n actions, the list ⊆ AUDIT_ACTIONS (AD-14); Date (04-C06, frame
// AuditRange) presets + calendar, whole days on the hub clock, future days off, at most 31 days, Cancel / Show n days.
// Integrator O4: the picker shows no role (the staff client holds no directory with roles; audit-staff has none).

/** A popover anchored under its filter; Escape or a press outside closes it (the filter gets the focus back). */
export function Popover({ label, wide, onClose, children }: { label: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    (el?.querySelector<HTMLElement>('input, [aria-checked="true"], button') ?? el)?.focus();
    const down = (e: PointerEvent) => {
      const wrap = el?.parentElement;
      if (wrap !== null && wrap !== undefined && e.target instanceof Node && !wrap.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={`pop${wide === true ? ' pop--w' : ''}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ staff

export function StaffPopover({
  api,
  selected,
  onPick,
  onClose,
}: {
  api: AuditApi;
  selected: string | null;
  onPick: (who: { staff_id: string; name: string } | null) => void;
  onClose: () => void;
}) {
  const [staff, setStaff] = useState<AuditStaffRow[] | 'loading' | 'failed'>('loading');
  const [find, setFind] = useState('');
  const load = useMemo(
    () => async () => {
      setStaff('loading');
      const answer = await api.auditStaff();
      setStaff(answer.ok ? answer.data : 'failed');
    },
    [api],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const needle = find.trim().toLocaleLowerCase();
  const people = Array.isArray(staff) ? staff.filter((s) => needle === '' || s.display_name.toLocaleLowerCase().includes(needle)) : [];
  return (
    <Popover label={t('audit.f.staff')} onClose={onClose}>
      <label className="pop__s">
        <AIco name="search" />
        <input type="search" placeholder={t('audit.staff.find')} aria-label={t('audit.staff.find')} value={find} onChange={(e) => setFind(e.target.value)} />
      </label>
      <div role="radiogroup" aria-label={t('audit.f.staff')} className="pop__list">
        {needle === '' && (
          <button type="button" className="pop__r" role="radio" aria-checked={selected === null} onClick={() => onPick(null)}>
            <span className="radio" />
            <span className="pop__n">{t('audit.f.everyone')}</span>
            <span className="end" />
          </button>
        )}
        {people.map((s) => (
          <button key={s.staff_id} type="button" className="pop__r" role="radio" aria-checked={selected === s.staff_id} onClick={() => onPick({ staff_id: s.staff_id, name: s.display_name })}>
            <span className="radio" />
            <span className="pop__n">
              <span className="av">{initial(s.display_name)}</span>
              {s.display_name}
            </span>
            <span className="end">{!s.in_directory && <span className="left">{t('audit.staff.left')}</span>}</span>
          </button>
        ))}
      </div>
      {staff === 'loading' && <span className="sk sk--pop" aria-busy="true" />}
      {staff === 'failed' && (
        <p className="hint" role="alert">
          {t('audit.staff.failed')}
          <button type="button" className="btn btn--quiet" onClick={() => void load()}>
            {t('audit.err.retry')}
          </button>
        </p>
      )}
      <p className="hint">
        <AIco name="info" />
        {t('audit.staff.hint')}
      </p>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------ actions

export function ActionsPopover({ selected, onApply, onClose }: { selected: readonly string[]; onApply: (actions: string[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ReadonlySet<string>>(() => new Set(selected));
  const toggle = (a: string) =>
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  const toggleGroup = (members: readonly string[]) =>
    setDraft((d) => {
      const n = new Set(d);
      const all = members.every((a) => n.has(a));
      for (const a of members) {
        if (all) n.delete(a);
        else n.add(a);
      }
      return n;
    });
  const count = draft.size;
  const show = count === 0 ? t('audit.actions.show_all') : count === 1 ? t('audit.actions.show_one') : fill(t('audit.actions.show'), { n: String(count) });
  return (
    <Popover label={t('audit.f.actions')} wide onClose={onClose}>
      <div className="pop__list">
        {AUDIT_GROUPS.map((g) => {
          const members = groupActions(g);
          return (
            <div key={g} role="group" aria-label={groupText(g)}>
              <div className="pop__g">
                <span className="pop__gt">{groupText(g)}</span>
                <button type="button" className="end" aria-pressed={members.every((a) => draft.has(a))} onClick={() => toggleGroup(members)}>
                  {t('audit.actions.all')}
                </button>
              </div>
              {members.map((a) => {
                const meta = actionMeta(a);
                const on = draft.has(a);
                return (
                  <button key={a} type="button" className="pop__r" role="checkbox" aria-checked={on} onClick={() => toggle(a)}>
                    <span className={`chk${on ? ' chk--on' : ''}`}>
                      <AIco name="check" />
                    </span>
                    <span className={`act act--pop c-${meta.tone}`}>
                      <i>
                        <AIco name={meta.icon} />
                      </i>
                      {actionText(a)}
                    </span>
                    <span />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="pop__f">
        <button type="button" className="btn" onClick={() => setDraft(new Set())}>
          {t('audit.actions.clear')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onApply([...draft])}>
          {show}
        </button>
      </div>
    </Popover>
  );
}

// ------------------------------------------------------------------------------------------------ date

const PRESETS: readonly Preset[] = ['today', 'yesterday', 'last7', 'month'];

export function DatePopover({
  range,
  nowMs,
  utcOffsetMs: off,
  onApply,
  onClose,
}: {
  range: DayRange;
  nowMs: number;
  utcOffsetMs: number;
  onApply: (r: DayRange) => void;
  onClose: () => void;
}) {
  const today = dayStart(nowMs, off);
  const [draft, setDraft] = useState<DayRange>(range);
  // the first tap of a new range: its other end comes next (within 31 days of it)
  const [anchor, setAnchor] = useState<number | null>(null);
  const last = draft.to - DAY_MS;
  const shown = hubDate(last, off);
  const [month, setMonth] = useState<{ y: number; m: number }>({ y: shown.y, m: shown.m });
  const now = hubDate(nowMs, off);
  const atNow = month.y === now.y && month.m === now.m;

  const pick = (day: number) => {
    if (anchor === null) {
      setAnchor(day);
      setDraft({ from: day, to: day + DAY_MS });
    } else {
      setDraft(daysRange(anchor, day, off));
      setAnchor(null);
    }
  };
  const tooFar = (day: number) => anchor !== null && Math.abs(day - anchor) >= MAX_DAYS * DAY_MS;

  // a Monday-first month grid (frame AuditRange), with the days of the months around it
  const first = hubMidnight(month.y, month.m, 1, off);
  const lead = (hubDate(first, off).wd + 6) % 7;
  const daysIn = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysIn) / 7) * 7;
  const grid = Array.from({ length: cells }, (_, i) => first + (i - lead) * DAY_MS);
  const heads = t('audit.range.weekheads').split(',');
  const monthTitle = fill(t('audit.range.month_title'), { month: t('audit.months_long').split(',')[month.m] ?? '', y: String(month.y) });
  const n = dayCount(draft);
  const p = presetOf(draft, nowMs, off);
  const go = (delta: number) => setMonth(({ y, m }) => ({ y: m + delta < 0 ? y - 1 : m + delta > 11 ? y + 1 : y, m: (m + delta + 12) % 12 }));

  return (
    <Popover label={t('audit.f.date')} wide onClose={onClose}>
      <div className="chips chips--pop">
        {PRESETS.map((x) => (
          <button
            key={x}
            type="button"
            className="chip"
            aria-pressed={p === x}
            onClick={() => {
              const r = presetRange(x, nowMs, off);
              setDraft(r);
              setAnchor(null);
              const d = hubDate(r.to - DAY_MS, off);
              setMonth({ y: d.y, m: d.m });
            }}
          >
            {t(`audit.range.${x}`)}
          </button>
        ))}
      </div>
      <div className="calh">
        <button type="button" className="btn btn--icon" aria-label={t('audit.range.prev')} onClick={() => go(-1)}>
          <AIco name="prev" />
        </button>
        <span aria-live="polite">{monthTitle}</span>
        <button type="button" className="btn btn--icon" aria-label={t('audit.range.next')} aria-disabled={atNow ? 'true' : undefined} onClick={() => !atNow && go(1)}>
          <AIco name="next" />
        </button>
      </div>
      <div className="cal" role="grid" aria-label={monthTitle}>
        {heads.map((h, i) => (
          <b key={i}>{h}</b>
        ))}
        {grid.map((day) => {
          const d = hubDate(day, off);
          const out = d.m !== month.m;
          const fut = day > today;
          const far = tooFar(day);
          const end = day === draft.from || day === last;
          const inside = day > draft.from && day < last;
          const cls = out ? 'out' : fut || far ? 'fut' : end ? 'a' : inside ? 'in' : '';
          const off_ = out || fut || far;
          return (
            <button
              key={day}
              type="button"
              className={cls}
              aria-disabled={off_ ? 'true' : undefined}
              aria-pressed={!out && (end || inside)}
              aria-label={longDayText(day, off)}
              onClick={() => !off_ && pick(day)}
            >
              <span className="num">{d.d}</span>
            </button>
          );
        })}
      </div>
      <div className="dr">
        <label>
          {t('audit.range.from')}
          <span className="inp num">{longDayText(draft.from, off)}</span>
        </label>
        <label>
          {t('audit.range.to')}
          <span className="inp num">{longDayText(last, off)}</span>
        </label>
      </div>
      <p className="hint">
        <AIco name="info" />
        {t('audit.range.limit')}
      </p>
      <div className="pop__f">
        <button type="button" className="btn" onClick={onClose}>
          {t('audit.range.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onApply(draft)}>
          {n === 1 ? t('audit.range.show_one') : fill(t('audit.range.show'), { n: String(n) })}
        </button>
      </div>
    </Popover>
  );
}
