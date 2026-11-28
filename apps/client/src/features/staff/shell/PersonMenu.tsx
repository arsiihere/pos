import { useEffect, useRef, useState } from 'react';
import { t, type Language } from '../../../i18n';
import { Ico, initial, type IconName } from '../../alerts/ui';

// 02b-TK A2 item 1 (frame PersonMenu; MAPPING TK-SH02; CHANGES §3 "Shell — proposed"): the person chip opens a menu —
// Switch user (00 HPA §6.9 M20 takeover: the shell's name tiles + PIN), Lock screen (the idle-lock screen now), My
// shift (#/shift, manage-own-shift), Sign out (POST /auth/logout; the unsent takeaway is held first, 02b-TK C1-5).
// The chip never signs out on one tap. Escape or a tap outside closes the menu; an item closes it, then acts.

export interface PersonMenuActions {
  onSwitch?: () => void;
  onLock?: () => void;
  /** My shift's sub-line ("Opened 7:02 AM · float Rs 5,000" / "No shift open …"), or null */
  shiftSub?: string | null;
  /** ⚠️ 02b v1.0.30 QK-3 (BUG-16): Language — English / اردو (kept on the device) */
  language?: { current: Language; onPick(lang: Language): void };
}

const LANGS: ReadonlyArray<{ lang: Language; label: string }> = [
  { lang: 'en', label: 'English' },
  { lang: 'ur', label: 'اردو' },
];

export interface PersonMenuProps extends PersonMenuActions {
  name: string;
  /** the header's second line ("Lake City · Cashier kiosk") */
  where: string;
  /** manage-own-shift: My shift is offered */
  shift: boolean;
  onShift: () => void;
  onSignOut: () => void;
}

function Item({ icon, label, sub, danger, onPick }: { icon: IconName; label: string; sub: string | null; danger?: boolean; onPick: () => void }) {
  return (
    <button type="button" role="menuitem" className={danger === true ? 'tk-mi tk-mi--danger' : 'tk-mi'} onClick={onPick}>
      <Ico name={icon} />
      <span>
        {label}
        {sub !== null && (
          <small>
            <bdi>{sub}</bdi>
          </small>
        )}
      </span>
    </button>
  );
}

export function PersonMenu(p: PersonMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: Event) => {
      if (root.current !== null && e.target instanceof Node && root.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  const pick = (act: (() => void) | undefined) => () => {
    setOpen(false);
    act?.();
  };
  return (
    <div className="tk-mewrap" ref={root}>
      <button type="button" className="me" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="av av--sm av--me">{initial(p.name)}</span>
        {p.name}
        <Ico name="down" className="ico--sm" />
      </button>
      {open && (
        <div className="tk-pop" role="menu" aria-label={p.name} ref={pop}>
          {/* ⚠️ L-CLIENT-6b item 8 (frame PersonMenu): the header with the saffron avatar */}
          <div className="tk-pop__h">
            <span className="av av--me" aria-hidden="true">
              {initial(p.name)}
            </span>
            <span>
              <b>
                <bdi>{p.name}</bdi>
              </b>
              <span className="muted">{p.where}</span>
            </span>
          </div>
          {p.onSwitch !== undefined && <Item icon="user" label={t('shell.me.switch')} sub={t('shell.me.switch_sub')} onPick={pick(p.onSwitch)} />}
          {p.onLock !== undefined && <Item icon="lock" label={t('shell.me.lock')} sub={t('shell.me.lock_sub')} onPick={pick(p.onLock)} />}
          {p.shift && <Item icon="cash" label={t('shell.me.shift')} sub={p.shiftSub ?? null} onPick={pick(p.onShift)} />}
          {p.language !== undefined && (
            <div className="tk-mi tk-mi--lang" role="group" aria-label={t('shell.me.language')}>
              <span>{t('shell.me.language')}</span>
              <span className="tk-mi__seg">
                {LANGS.map((l) => (
                  <button key={l.lang} type="button" role="menuitemradio" aria-checked={p.language!.current === l.lang} lang={l.lang} dir={l.lang === 'ur' ? 'rtl' : 'ltr'} onClick={pick(() => p.language!.onPick(l.lang))}>
                    {l.label}
                  </button>
                ))}
              </span>
            </div>
          )}
          <Item icon="signout" label={t('shell.me.signout')} sub={t('shell.me.signout_sub')} danger onPick={pick(p.onSignOut)} />
        </div>
      )}
    </div>
  );
}
