import { useEffect, useRef, useState } from 'react';
import { onHashChangeFirst } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Dialog, Ico } from '../../../alerts/ui';
import { takeLeavePass } from './leave-pass';

// 02b-TK C1-5 (frame LeaveGuard; 02b §8 Ordering screen "Hold", Held): leaving the takeaway screen with an unsent cart
// — a tab, Back, the browser's back — asks "This order isn't sent": Hold it (the safe choice) / Throw away / Stay
// here. Every in-app way out changes the hash, so the guard listens to `hashchange`: while it is armed it puts this
// screen's route back (history.replaceState, no second hashchange) before the router reads it, and asks where the
// person was going. A deep link passes (leave-pass.ts, 01d #105: its Back returns to the cart). Sign out and the idle
// lock do not ask: the screen holds the cart itself (OrderScreen auto-hold).

/**
 * Arms the guard on this route; `pending` is where the person was going, null while nobody is leaving. `ask(to)` asks
 * without a hash change (02b-TK A2 item 2: F2 New takeaway on the Takeaway tab, `to` = this route = a fresh cart).
 */
export function useLeaveGuard(here: string, armed: () => boolean): { pending: string | null; clear(): void; ask(to: string): void } {
  const [pending, setPending] = useState<string | null>(null);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  useEffect(() => {
    const onHash = () => {
      const to = window.location.hash.replace(/^#/, '') || '/';
      if (to === here) return;
      if (takeLeavePass(to) || !armedRef.current()) return;
      window.history.replaceState(window.history.state, '', `#${here}`);
      setPending(to);
    };
    // L-CLIENT-6a item 10: through the router's own listener, before any route reader (app/router.ts), so the route
    // it reads is already this screen's again (a capturing window listener ran after the router's in Chrome)
    return onHashChangeFirst(onHash);
  }, [here]);
  return { pending, clear: () => setPending(null), ask: (to: string) => setPending(to) };
}

export function LeaveGuard(p: { items: string; money: string; sheet: boolean; onHold(): void; onDiscard(): void; onStay(): void }) {
  return (
    <Dialog sheet={p.sheet} labelledBy="leave-t" onClose={p.onStay}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="leave-t">
            <Ico name="warn" /> {t('l.title')}
          </h2>
          <div className="ac__who">{fill(t('l.body'), { n: p.items, money: p.money })}</div>
        </div>
      </div>
      <button type="button" className="btn btn--primary btn--lg btn--block" onClick={p.onHold}>
        {t('l.hold')}
      </button>
      <div className="acts acts--eq">
        <button type="button" className="btn" onClick={p.onDiscard}>
          {t('l.discard')}
        </button>
        <button type="button" className="btn" onClick={p.onStay}>
          {t('l.stay')}
        </button>
      </div>
    </Dialog>
  );
}
