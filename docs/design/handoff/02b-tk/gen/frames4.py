from frames import frame
from core import *  # noqa
import core


def ba(title, why, before, after):
    return f'''<div class="cell col" style="gap:14px"><h1 style="font-size:24px">{title}</h1><p class="muted" style="margin:0; font-size:16px">{why}</p>
<div class="ba"><div class="ba__b"><h4 style="color:var(--danger)">Before (v1 of this design)</h4>{before}</div><div class="ba__a"><h4 style="color:var(--ok)">After (frames in this hand-off)</h4>{after}</div></div></div>'''


@frame('HostileReview', 'TK-HR', 'component', 'review', 'Hostile review — tired cashier, 1:30 PM, 15 in queue: what could lose an order or money, before → after')
def _():
    due = core.READY[1]
    v1_due = f'<div style="width:200px"><button class="tk-rt tk-rt--due"><span class="tok" dir="ltr" style="color:var(--ink)">50</span>{chip("Due", "solid-danger")}<span class="tk-rt__who">—</span><span class="tk-rt__act" style="color:var(--ok)">{ico("hand", "ico ico--sm")}Hand over</span></button></div><p>Same 1-tap “Hand over” on an unpaid tile: the bag leaves, the bill stays open, nobody notices until day close.</p>'
    v2_due = f'<div style="width:200px">{ready_tile(due)}</div><p>An unpaid ready tile has only <b>Take payment</b>. Hand over appears after Paid. Board shows “Pay at counter”. Token view keeps “Hand over” off with “Pay first”.</p>'
    v1_send = f'<div class="tk-acts"><button class="tk-btn tk-btn--xl tk-btn--primary">Send</button><button class="tk-btn tk-btn--xl tk-btn--primary">Send & pay</button></div><p>Two saffron buttons side by side → wrong one at speed; unpaid orders walk out.</p>'
    v2_send = f'<div class="tk-acts"><button class="tk-btn tk-btn--lg">{t("c.send_later")} {kbd("F9")}</button><button class="tk-btn tk-btn--xl tk-btn--primary">{ico("cash")}{t("c.send_pay")} {kbd("F8")}</button></div><p>One primary (Send & pay, wider, 72 px). Pay later is plain and narrower. If it is pressed, the token row and tile carry a red <b>Due</b> until paid.</p>'
    v1_pack = f'<div class="pk pk--ready" style="width:300px"><div class="pk__h"><span class="tk-tok">54</span><b>Waiting at counter</b></div><button class="tk-btn tk-btn--lg">{ico("hand")}Handed over</button></div><p>Packer hands bag 54 to the customer from the pass — it was never paid.</p>'
    v2_pack = f'<div class="pk pk--ready" style="width:300px"><div class="pk__h"><span class="tk-tok">54</span><b>Waiting at counter</b></div><div class="pk__l">{chip("Due Rs 1,800 — customer pays at counter", "solid-danger")}</div><button class="tk-btn tk-btn--lg" aria-disabled="true">{ico("hand")}Handed over · pay first</button></div><p>Due shows on the pass card; Handed over is off until paid (hub check in GAPS G-7).</p>'
    v1_off = f'<button class="tk-btn tk-btn--xl tk-btn--primary tk-btn--block">{ico("cash")}Send & pay</button><p>Offline, Send & pay sends, then the pay step fails; the cashier already took Rs 5,000 cash and the payment is never recorded.</p>'
    v2_off = f'<div class="tk-hint" style="background:var(--warn-tint); color:var(--warn)">{ico("wifioff", "ico ico--sm")}{t("c.queued_pay")}</div><button class="tk-btn tk-btn--xl tk-btn--primary tk-btn--block" style="margin-top:8px">{ico("send", "ico flip")}{t("c.send_later")}</button><p>Offline the primary becomes Send (queues). The order is Due, so it shows red when the hub is back and cannot be handed over unpaid.</p>'
    v1_ho = f'<div class="tk-toast" style="position:static">{ico("hand")}Handed over</div><p>48 and 58 sit next to each other; a wrong 1-tap hand-over has no way back.</p>'
    v2_ho = f'<div class="tk-toast tk-toast--ok" style="position:static">{ico("hand")}<span><b dir="ltr" style="font-size:28px">48</b> {t("t.collected")}</span><button class="tk-btn">{t("t.undo")}</button></div><p>Toast repeats the token in 28 px with Undo for 5 s; the board voice already called “48”.</p>'
    v1_q = f'<div class="tk-qchips"><button>×2</button><button>×4</button><button>×6</button><button>×8</button><button>×10</button></div><p>×8 and ×10 at the screen edge: a slip gives 10 naan.</p>'
    v2_q = f'<div class="tk-qchips"><button>×2</button><button>×4</button><button>×6</button><button>×8</button></div><p>Four chips, and the line count updates in 20 px next to the stepper; more than 8 is typed (“10n”).</p>'
    v1_leave = f'<p>Tap “Parking” with 11 items in the cart → cart gone (today’s bug, kept in v1 because the draft was “saved”).</p>'
    v2_leave = f'<p><b>Leave guard</b> on every exit (tab, Back, sign out, deep link): Hold / Throw away / Stay. Sign out and idle lock hold automatically. Held list is per counter, not per person (GAPS G-6).</p>'
    h = ['<div class="cmp col" style="gap:22px; padding:40px; flex:1"><h1>Hostile review — 1:30 PM, 15 people in the queue</h1>',
         '<div class="cmp-grid--2 cmp-grid">',
         ba('1 · Unpaid bag handed over', 'Mixed pay-first / pay-later means some ready bags are unpaid.', v1_due, v2_due),
         ba('2 · Wrong send button', 'Under pressure the cashier hits whatever is saffron.', v1_send, v2_send),
         ba('3 · Packer hands over unpaid', 'Sometimes the kitchen pass hands bags over.', v1_pack, v2_pack),
         ba('4 · Offline cash lost', 'Hub drops for 2 minutes in the rush.', v1_off, v2_off),
         ba('5 · Wrong token handed over', 'Similar tokens, glare, noise.', v1_ho, v2_ho),
         ba('6 · Quantity slip / lost cart', 'Fat-finger at the edge; tab tapped by habit.', v1_q + v1_leave, v2_q + v2_leave),
         '</div></div>']
    return page('Hostile review', ''.join(h), 'sheet', 'cmp')
