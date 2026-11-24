from frames import frame, kiosk, QTY
from frames2 import qr_svg, pay_panel, token_drawer, il
from core import *  # noqa
import core

# ====================================================================== TABLET 1280 × 800


def rstrip():
    tiles = ''.join(ready_tile(r) for r in core.READY[:4])
    return f'<div class="tk-rstrip">{tiles}<button class="tk-rstrip__q">{ico("bag")}{t("q.all")} · {num(14)}<small>{num(4)} {t("q.cooking")} · {num(2)} {t("ctx.phone_order")}</small></button></div>'


def tablet_menu(qtys=None):
    qtys = qtys or {}
    keys = ['paye', 'ck', 'rnaan', 'lassi', 'tawa', 'naan']
    tiles = ''.join(tile(k, qtys.get(k, 0), split=(k in ('ck', 'mk')), off=(t('m.sold_out') if k == 'tikka' else None), zone=(18 if k == 'paye' else None)) for k in keys)
    return f'<section class="tk-mid">{rstrip()}<div class="tk-mtop"><div class="tk-search">{ico("search")}{t("m.search")}</div></div>{cats("top")}<div class="tk-grid">{tiles}</div></section>'


def tablet(top_html, mid, cart_html, overlay=''):
    return f'{top_html}<div class="tk-body">{mid}{cart_html}</div>{overlay}'


@frame('HomeTablet', 'TK-S01', 'tablet', 'normal', 'Tablet 1280×800 — ready strip on top (tap = hand over / pay), menu 3 columns, cart 440; queue opens as a drawer')
def _():
    return page('Tablet', tablet(top(ctx=ctx_new(name='Usman'), req=0), tablet_menu(QTY), cart(compact=True)), 'tablet')


@frame('HomeTabletUrdu', 'TK-S01', 'tablet', 'urdu', 'Tablet in Urdu', 'ur')
def _():
    return page('ٹیبلٹ', tablet(top(ctx=ctx_new(name='Usman'), req=0), tablet_menu(QTY), cart(compact=True)), 'tablet')


@frame('PayNfcTablet', 'TK-D06', 'tablet', 'normal', 'Card by NFC on the tablet (Paymob) — “Tap the card on the back of this tablet”')
def _():
    p = pay_panel('card')
    nfc = f'<div style="height:12px"></div><div class="tk-nfc"><div class="tk-nfc__ring">{ico("nfc")}</div><b style="font-size:21px">{t("p.nfc")}</b><span>{money(3650)} · {"waiting for card…" if not ur() else "کارڈ کا انتظار…"}</span></div>'
    start = p.index('<div style="height:14px"></div><div class="tk-qrbox"')
    end = p.index('<div class="grow"></div>', start)
    p = p[:start] + nfc + p[end:]
    p = p.replace(f'{ico("check")}{t("p.done")}', f'{t("p.cash")} {"instead" if not ur() else "کیش سے"}')
    return page('NFC', tablet(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title')), req=0), tablet_menu(), cart(compact=True, overlay=p)), 'tablet')


@frame('QueueTablet', 'TK-S03', 'tablet', 'rush', 'Tablet — full queue as a drawer (40 open, search by token / name / last 4 digits)')
def _():
    q = queue('rush').replace('<aside class="tk-q tk-q--compact">', '<aside class="tk-q tk-q--compact" style="display:flex; width:460px; position:absolute; top:72px; bottom:0; inset-inline-start:0; z-index:30; box-shadow:var(--shadow-pop)">')
    return page('Queue tablet', tablet(top(ctx=ctx_new(), rush_n=40, req=0), tablet_menu(), cart(compact=True)) + '<div class="tk-scrim" style="top:72px"></div>' + q, 'tablet')


# ====================================================================== PHONE 390 × 844


def ph_top(title, sub, live=True):
    lv = f'<span class="tk-live" style="height:34px; padding:0 10px">{t("shell.live")}</span>' if live else f'<span class="tk-live tk-live--off" style="height:34px; padding:0 10px">{t("shell.offline")}</span>'
    return f'<header class="ph-top"><span class="tk-ctx__ic" style="width:40px;height:40px">{ico("bag")}</span><div class="grow"><b>{title}</b><small>{sub}</small></div>{lv}<span class="tk-av">{nm("Zain")[0]}</span></header>'


def ph_tabs(sel):
    tabs = [('menu', t('m.all').split(' ')[0] if False else ('Menu' if not ur() else 'مینو'), ''), ('cart', ('Cart' if not ur() else 'آرڈر'), f'<span class="tk-chip tk-chip--brand num" style="height:24px">11</span>'), ('queue', ('Queue' if not ur() else 'قطار'), f'<span class="tk-count num">4</span>')]
    return '<nav class="ph-tabs">' + ''.join(f'<button class="{"is-sel" if k == sel else ""}">{lab}{extra}</button>' for k, lab, extra in tabs) + '</nav>'


def ph_bar():
    return f'<div class="ph-bar"><div class="ph-bar__t"><b dir="ltr">Rs 3,650</b><small>{ico("clock", "ico ico--sm")} {t("c.ready_by")} <span dir="ltr">1:42 PM</span></small></div><button class="tk-btn tk-btn--lg">{t("c.send_later").split(" · ")[0]}</button><button class="tk-btn tk-btn--xl tk-btn--primary">{ico("cash")}{"Pay" if not ur() else "پیسے"}</button></div>'


@frame('PhoneMenu', 'TK-S01', 'phone', 'normal', 'Phone — Menu tab, 2 columns, wait on every tile, sticky bar with total + Ready by')
def _():
    keys = ['paye', 'ck', 'rnaan', 'lassi', 'tawa', 'naan']
    tiles = ''.join(tile(k, QTY.get(k, 0), zone=(18 if k == 'paye' else None)) for k in keys)
    body = f'<div class="ph-body"><div class="tk-search">{ico("search")}{t("m.search")}</div>{cats("top")}<div class="tk-grid">{tiles}</div></div>'
    return page('Phone menu', ph_top(t('ctx.new') + ' · ' + nm('Usman'), t('ctx.token_after')) + ph_tabs('menu') + body + ph_bar(), 'phone')


@frame('PhoneCart', 'TK-S01', 'phone', 'normal', 'Phone — Cart tab: name / phone / pickup, lines with steppers and times')
def _():
    lines = std_lines()
    body = f'<div class="ph-body">{cust(name="Usman").replace("tk-cust__r", "tk-cust__r col")}{lines}</div>'
    return page('Phone cart', ph_top(t('ctx.new') + ' · ' + nm('Usman'), t('ctx.token_after')) + ph_tabs('cart') + body + ph_bar(), 'phone')


@frame('PhoneQueue', 'TK-S03', 'phone', 'normal', 'Phone — Queue tab: ready first (hand over / pay), then cooking, then phone orders')
def _():
    body = f'<div class="ph-body"><div class="tk-search">{ico("search")}{t("q.search")}</div><div class="tk-sec">{t("q.ready")}</div><div class="tk-ready">{"".join(ready_tile(r) for r in core.READY)}</div><div class="tk-sec">{t("q.cooking")}</div>{q_row(core.COOKING[0])}{q_row(core.COOKING[1])}</div>'
    return page('Phone queue', ph_top(t('shell.tab.takeaway'), f'{num(14)} {"open" if not ur() else "کھلے"}') + ph_tabs('queue') + body, 'phone')


@frame('PhoneToken', 'TK-S03', 'phone', 'normal', 'Phone — one token full screen: stages, Hand over / Pay, Add items')
def _():
    lines = il(2, iname('paye'), t('c.counter'), 'ready') + il(2, iname('lassi'), '', 'cooking')
    body = f'''<div class="ph-body"><div class="row"><span class="tk-tv__tok" dir="ltr" style="height:84px;font-size:52px">54</span><div class="tk-tv__who"><b>{t("shell.tab.takeaway")}</b><small>{t("v.ready_at")} {tm("1:24 PM")}</small></div></div>
<div class="tk-facts" style="grid-template-columns:1fr 1fr"><div class="tk-fact tk-fact--due"><small>{t("v.bill")}</small><b>{money(1800)}</b></div><div class="tk-fact"><small>{t("c.phone")}</small><b>—</b></div></div>{lines}
<button class="tk-btn tk-btn--lg">{ico("hand")}{t("v.give_ready")}</button><div class="tk-grid2"><button class="tk-btn">{ico("plus")}{t("v.add")}</button><button class="tk-btn">{ico("trash")}{t("v.remove")}</button></div></div>
<div class="ph-bar"><button class="tk-btn tk-btn--xl tk-btn--primary tk-btn--block">{ico("cash")}{t("v.pay")} · {money(1800)}</button></div>'''
    return page('Phone token', f'<header class="ph-top"><button class="tk-btn tk-btn--chrome" style="min-height:48px">{ico("back", "ico flip")}</button><div class="grow"><b>Token 54</b><small>{t("q.due")}</small></div></header>' + body, 'phone')


@frame('PhoneCartUrdu', 'TK-S01', 'phone', 'urdu', 'Phone cart in Urdu', 'ur')
def _():
    body = f'<div class="ph-body">{cust(name="Usman").replace("tk-cust__r", "tk-cust__r col")}{std_lines()}</div>'
    return page('فون', ph_top(t('ctx.new') + ' · ' + nm('Usman'), t('ctx.token_after')) + ph_tabs('cart') + body + ph_bar(), 'phone')


@frame('PhoneOffline', 'TK-S01', 'phone', 'offline', 'Phone offline — times “—”, Send queues, Pay hidden (needs hub)')
def _():
    body = f'<div class="ph-body"><div class="tk-banner tk-banner--danger" style="margin:-12px -12px 0">{ico("wifioff")}Hub offline — orders are kept and sent later</div>{std_lines(offline=True)}</div>'
    bar = f'<div class="ph-bar"><div class="ph-bar__t"><b dir="ltr">Rs 3,650</b><small style="color:var(--ink-muted)">{t("c.times_none")}</small></div><button class="tk-btn tk-btn--xl tk-btn--primary">{ico("send", "ico flip")}{"Send" if not ur() else "بھیجیں"}</button></div>'
    return page('Phone offline', ph_top(t('ctx.new') + ' · ' + nm('Usman'), t('ctx.token_after'), live=False) + ph_tabs('cart') + body + bar, 'phone')


# ====================================================================== PICKUP BOARD (TV 1920 × 1080)


def board(ready, prep, call=None, phone=None, empty=False, offline=False, more=None):
    rd = ''.join(f'<div class="bd-t{" bd-t--call" if r[0] == call else ""}{" bd-t--part" if len(r) > 2 and r[2] == "part" else ""}"><span class="tok" dir="ltr">{r[0]}</span><small>{r[1]}</small></div>' for r in ready)
    pp = ''.join(f'<div class="bd-p{" bd-p--late" if len(p) > 2 and p[2] == "late" else ""}{" bd-p--phone" if len(p) > 2 and p[2] == "phone" else ""}"><span class="tok" dir="ltr">{p[0]}</span><small>{p[1]}</small></div>' for p in prep)
    top_ = f'<header class="bd-top"><span class="bd-logo">AC</span><div><h1>Arif Chatkhara</h1><span class="ur">عارف چٹخارا · لیک سٹی</span></div><span class="bd-clock" dir="ltr">1:34 PM</span></header>'
    if offline:
        top_ = top_.replace('<span class="bd-clock"', '<span class="tk-chip tk-chip--warn tk-chip--lg" style="margin-inline-start:auto; height:52px; font-size:24px">Updating… · اپ ڈیٹ ہو رہا ہے</span><span class="bd-clock" style="margin-inline-start:24px"')
    if empty:
        mid = f'<div class="tk-empty" style="flex:1; color:#D2B9AC"><div class="bd-logo" style="width:160px;height:160px;font-size:64px;border-radius:40px">AC</div><b style="color:#FFF3E6; font-size:56px">Welcome · خوش آمدید</b><p style="font-size:30px; max-width:900px">Order at the counter — your token shows here when it is ready<br><span style="font-family:var(--font-urdu); line-height:1.8">کاؤنٹر پر آرڈر دیں — تیار ہونے پر آپ کا ٹوکن یہاں نظر آئے گا</span></p></div>'
    else:
        more_h = f'<div class="bd-more">+{more} more · مزید {more}</div>' if more else ''
        mid = f'''<div class="bd-cols"><section class="bd-col bd-col--ready"><div class="bd-col__h"><b>Ready</b><span class="ur">تیار ہے</span></div><div class="bd-tiles">{rd}</div></section>
<section class="bd-col bd-col--prep"><div class="bd-col__h"><b>Preparing</b><span class="ur">بن رہا ہے</span></div><div class="bd-tiles">{pp}</div>{more_h}</section></div>'''
    callb = ''
    if call:
        callb = f'<div class="bd-call"><span class="tok" dir="ltr">{call}</span><div><b>Token {call} — please come to the counter</b><div class="ur">ٹوکن نمبر {call} — کاؤنٹر پر تشریف لائیں</div></div><span style="margin-inline-start:auto">{ico("speaker", "ico", "width:96px;height:96px")}</span></div>'
    foot_ = f'<footer class="bd-foot">{ico("qr", "ico", "width:44px;height:44px")}<span>Find your token on your slip · scan the QR to follow your order</span><span class="ur" style="margin-inline-start:auto">اپنا ٹوکن نمبر پرچی پر دیکھیں</span></footer>'
    return top_ + mid + callb + foot_


READY_B = [(48, 'Ali'), (50, 'Pay at counter'), (46, 'Kamran'), (52, 'Paye ready', 'part'), (57, 'Usman'), (58, 'Zain')]
PREP_B = [(53, '~1:31'), (54, '~1:24'), (55, '~1:35'), (56, '~1:38'), (59, '~1:40'), (60, '~1:41'), (61, '~1:44'), (62, '~1:46'), (63, '~1:47', 'late'), ('Saima', 'phone · 2:00', 'phone'), ('Imran', 'phone · 2:30', 'phone')]


@frame('Board', 'TK-S05', 'tv', 'normal', 'Pickup board (TV) — Ready (green, big) / Preparing (with ~time); English + Urdu; no names for unpaid; phone orders by first name')
def _():
    return page('Board', board(READY_B, PREP_B), 'tv', 'bd', theme='dark', dir_override='ltr')


@frame('BoardCall', 'TK-S05', 'tv', 'normal', 'Call-out — a token turns ready: tile flashes, banner + chime + recorded Urdu voice “Token number sattavan”')
def _():
    return page('Board call', board(READY_B, PREP_B, call=57), 'tv', 'bd', theme='dark', dir_override='ltr')


@frame('BoardRush', 'TK-S05', 'tv', 'rush', 'RUSH — 40 open: oldest ready first, Preparing shows 16 + “+18 more”; no scrolling')
def _():
    ready = [(40 + i, n) for i, n in enumerate(['Ali', 'Sana', '—', 'Hira', 'Owais', 'Faisal'])] + [(48, 'Ali'), (50, '—'), (52, 'Paye ready', 'part')]
    prep = [(53 + i, f'~1:{31 + i}') for i in range(15)] + [('Saima', 'phone · 2:00', 'phone')]
    return page('Board rush', board(ready, prep, more=18), 'tv', 'bd', theme='dark', dir_override='ltr')


@frame('BoardEmpty', 'TK-S05', 'tv', 'empty', 'Board with no orders — welcome in English + Urdu')
def _():
    return page('Board empty', board([], [], empty=True), 'tv', 'bd', theme='dark', dir_override='ltr')


@frame('BoardOffline', 'TK-S05', 'tv', 'offline', 'Board lost the hub — keeps the last list, “Updating…”, never shows a wrong Ready')
def _():
    return page('Board offline', board(READY_B[:4], PREP_B[:8], offline=True), 'tv', 'bd', theme='dark', dir_override='ltr')


# ====================================================================== PACKER (03b Pass, takeaway filter)


@frame('PackerPass', 'TK-S06', 'tablet', 'normal', 'Packer / Pass (tablet) — takeaway filter: “Pack next” by time; Bag ready = ReadyToServe → board + cashier tile')
def _():
    cards = []
    data = [(54, 'next', [(2, iname('paye'), 'ready'), (2, iname('lassi'), 'cooking')], '1:24 PM'),
            (53, '', [(1, f'{t("m.half")} {iname("ck")}', 'cooking'), (4, iname('rnaan'), 'waiting')], '1:31 PM'),
            (55, '', [(1, iname('tawa'), 'cooking'), (3, iname('roti'), 'waiting')], '1:35 PM'),
            (48, 'ready', [(1, f'{t("m.full")} {iname("ck")}', 'ready'), (6, iname('rnaan'), 'ready'), (1, iname('raita'), 'ready')], '1:12 PM'),
            (56, '', [(2, iname('seekh'), 'cooking'), (1, iname('raita'), 'ready')], '1:38 PM'),
            ('📞', '', [(1, f'{t("m.full")} {iname("mk")}', 'waiting'), (8, iname('naan'), 'waiting')], '2:00 PM')]
    for tok, st, lines, tm_ in data:
        ls = ''.join(f'<div class="pk__l"><span class="q num">{q}×</span>{n}{chip({"ready": t("v.ready"), "cooking": t("v.cooking"), "waiting": t("v.waiting")}[s], {"ready": "ok", "cooking": "warn", "waiting": ""}[s])}</div>' for q, n, s in lines)
        btn = f'<button class="tk-btn tk-btn--lg tk-btn--ok">{ico("bag")}{"Bag ready" if not ur() else "تھیلا تیار"}</button>' if st != 'ready' else f'<button class="tk-btn tk-btn--lg">{ico("hand")}{"Handed over" if not ur() else "دے دیا"}</button>'
        if tok == 54:
            ls = f'<div class="pk__l">{chip("Due Rs 1,800 — customer pays at counter", "solid-danger")}</div>' + ls
        tokh = f'<span class="tk-tok{" tk-tok--phone" if tok == "📞" else ""}" dir="ltr">{tok if tok != "📞" else ico("phone")}</span>'
        cards.append(f'<div class="pk{" pk--next" if st == "next" else ""}{" pk--ready" if st == "ready" else ""}"><div class="pk__h">{tokh}<div class="grow"><b style="font-size:18px">{"Pack next" if st == "next" else ("Waiting at counter" if st == "ready" else "")}</b><div class="muted">{t("v.ready_at")} {tm(tm_)}</div></div></div>{ls}<div class="grow"></div>{btn}</div>')
    top_ = f'<header class="tk-top"><div class="tk-ctx"><span class="tk-ctx__ic">{ico("bag")}</span><div><b>{"Pass · Takeaway" if not ur() else "پاس · ٹیک اوے"}</b><small>{"Upstairs pass · Lake City" if not ur() else "اوپر کا پاس"}</small></div></div><nav class="tk-tabs"><button class="tk-tab">{"All" if not ur() else "سب"}</button><button class="tk-tab">{"Dine-in" if not ur() else "ڈائن اِن"}</button><button class="tk-tab is-sel">{ico("bag")}{t("shell.tab.takeaway")}<span class="tk-count num">6</span></button><button class="tk-tab">{t("shell.tab.parking")}</button></nav><div class="tk-end"><span class="tk-live">{t("shell.live")}</span><span class="tk-clock">1:20 PM</span><span class="tk-me"><span class="tk-av">R</span>Rashid</span></div></header>'
    return page('Packer', top_ + f'<div class="pk-grid">{"".join(cards)}</div>', 'tablet')


# ====================================================================== CUSTOMER STATUS PAGE (slip QR, restaurant Wi-Fi)


def status(stage='cooking'):
    steps = [('Order received', 'آرڈر مل گیا', 'done'), ('Cooking', 'بن رہا ہے', 'now' if stage == 'cooking' else 'done'), ('Ready — come to the counter', 'تیار — کاؤنٹر پر آئیں', 'now' if stage == 'ready' else '')]
    sh = ''.join(f'<div class="cs-step{" cs-step--done" if s == "done" else ""}{" cs-step--now" if s == "now" else ""}"><span class="cs-step__d">{ico("check", "ico ico--sm") if s == "done" else ""}</span><span>{u if ur() else e}</span></div>' for e, u, s in steps)
    if stage == 'ready':
        hero = f'<div class="cs-card" style="background:var(--ok-fill); color:#fff; text-align:center"><b style="font-size:26px">{"Your order is ready!" if not ur() else "آپ کا آرڈر تیار ہے!"}</b><div class="cs-tok" style="color:#fff" dir="ltr">57</div><span style="font-size:18px; font-weight:700">{"Show this screen at the counter" if not ur() else "یہ اسکرین کاؤنٹر پر دکھائیں"}</span></div>'
    else:
        hero = f'<div class="cs-card" style="text-align:center"><small class="muted" style="font-size:16px; font-weight:700">{"Your token" if not ur() else "آپ کا ٹوکن"}</small><div class="cs-tok" dir="ltr">57</div><div class="tk-readyby" style="text-align:start"><span class="tk-readyby__ic">{ico("clock")}</span><div class="tk-readyby__t"><small>{"Ready around" if not ur() else "تقریباً تیار"}</small><b dir="ltr">1:42 PM</b></div></div></div>'
    items = ''.join(f'<div class="cs-step"><span class="num" style="min-width:34px">{q}×</span><span class="grow">{n}</span>{chip(s1, tone)}</div>' for q, n, s1, tone in [(2, iname('paye'), t('v.ready'), 'ok'), (1, f'{t("m.half")} {iname("ck")}', t('v.ready') if stage == 'ready' else t('v.cooking'), 'ok' if stage == 'ready' else 'warn'), (4, iname('rnaan'), t('v.ready') if stage == 'ready' else '1:42', 'ok' if stage == 'ready' else '')])
    return f'''<header class="cs-top"><span class="bd-logo">AC</span><div class="grow"><b>Arif Chatkhara</b><div style="font-size:14px; opacity:.8">{"Lake City · Takeaway" if not ur() else "لیک سٹی · ٹیک اوے"}</div></div></header>
{hero}<div class="cs-card"><div class="cs-steps">{sh}</div></div><div class="cs-card"><b style="font-size:18px">{"Your items" if not ur() else "آپ کی چیزیں"}</b>{items}</div>
<p class="muted" style="margin:0 20px; font-size:14px; text-align:center">{"This page updates by itself on the restaurant Wi-Fi. Keep it open — it beeps when ready." if not ur() else "یہ صفحہ خود اپ ڈیٹ ہوتا ہے۔ کھلا رکھیں — تیار ہونے پر آواز آئے گی۔"}</p>'''


@frame('StatusCooking', 'TK-S07', 'phone', 'normal', 'Customer status page (slip QR → restaurant Wi-Fi) — token, “Ready around 1:42 PM”, items')
def _():
    return page('Status', status('cooking'), 'phone', 'cs')


@frame('StatusReady', 'TK-S07', 'phone', 'normal', 'Customer status page — ready (green), beeps, “show this screen at the counter”')
def _():
    return page('Status ready', status('ready'), 'phone', 'cs')


@frame('StatusUrdu', 'TK-S07', 'phone', 'urdu', 'Customer status page in Urdu', 'ur')
def _():
    return page('اسٹیٹس', status('cooking'), 'phone', 'cs')


# ====================================================================== TOKEN SLIP (80 mm)


@frame('TokenSlip', 'TK-P01', 'slip', 'normal', 'Token slip (80 mm) — token huge, ready ~time, Urdu line, QR to the status page; receipt stays as 05 prints it')
def _():
    qr = qr_svg(200, 3)
    body = f'''<div class="slip"><h1>ARIF CHATKHARA</h1><div class="c">Lake City · Takeaway</div><hr><div class="c">TOKEN</div><div class="big">57</div><div class="ur">ٹوکن نمبر 57</div><div class="c" style="font-size:26px; font-weight:800">Ready ~1:42 PM</div><div class="c">Paye: now · Karahi: ~1:42</div><hr>
<div class="r"><span>2x Paye</span><span>1,300</span></div><div class="r"><span>1x Half Chicken Karahi</span><span>1,450</span></div><div class="r"><span>4x Roghni Naan</span><span>280</span></div><div class="r"><span>2x Lassi sweet</span><span>500</span></div><div class="r"><span>1x Raita</span><span>120</span></div><hr><div class="r" style="font-weight:800; font-size:26px"><span>TOTAL</span><span>Rs 3,650</span></div><div class="r"><span>PAID cash</span><span>5,000</span></div><div class="r"><span>Change</span><span>1,350</span></div><hr>
<div style="width:200px; height:200px; margin:0 auto">{qr}</div><div class="c">Scan on restaurant Wi-Fi to follow your order</div><div class="ur">اپنا آرڈر دیکھنے کیلئے اسکین کریں</div><div class="c" style="font-size:18px">#57 · 1:20 PM · Sana · 24 Nov 2026</div></div>'''
    return page('Slip', body, 'slip', 'cmp')


# ====================================================================== COUNTER-FACING CUSTOMER DISPLAY


@frame('CustomerDisplay', 'TK-S08', 'display', 'normal', 'Customer-facing display at the counter — cart mirror with total and Ready by, while the cashier types')
def _():
    rows = ''.join(f'<div class="cd-row"><span class="q num">{q}×</span><span>{n}</span>{money(p)}</div>' for q, n, p in [(2, 'Paye · پائے', 1300), (1, 'Raita · رائتہ', 120), (1, 'Half Chicken Karahi · آدھی چکن کڑاہی', 1450), (4, 'Roghni Naan · روغنی نان', 280), (2, 'Lassi · لسی', 500)])
    r = f'<div class="cd-r"><span class="bd-logo" style="width:96px;height:96px;font-size:40px">AC</span><div style="font-size:30px; font-weight:700">Total · کل</div><div class="big" dir="ltr">Rs 3,650</div><div class="tk-readyby" style="width:100%; justify-content:center"><span class="tk-readyby__ic">{ico("clock")}</span><div class="tk-readyby__t" style="flex:none"><small>Ready by · تیار ہوگا</small><b dir="ltr">1:42 PM</b></div></div><div class="ur">شکریہ! اپنا ٹوکن پرچی پر دیکھیں</div></div>'
    return page('Customer display', f'<div class="cd"><div class="cd-l"><h2>Your order · آپ کا آرڈر</h2>{rows}</div>{r}</div>', 'display', 'cs', dir_override='ltr')


@frame('CustomerDisplayRaast', 'TK-S08', 'display', 'normal', 'Customer display during Raast — big QR for this amount, auto “Paid ✓” when the bank confirms')
def _():
    r = f'<div class="cd-r"><div style="font-size:30px; font-weight:700">Scan to pay · اسکین کر کے ادا کریں</div><div class="tk-qr-img" style="width:420px;height:420px">{qr_svg(392, 11)}</div><div class="big" dir="ltr">Rs 3,650</div><div style="font-size:24px">Any bank app · Raast · کسی بھی بینک ایپ سے</div></div>'
    rows = ''.join(f'<div class="cd-row"><span class="q num">{q}×</span><span>{n}</span>{money(p)}</div>' for q, n, p in [(2, 'Paye · پائے', 1300), (1, 'Raita · رائتہ', 120), (1, 'Half Chicken Karahi · آدھی چکن کڑاہی', 1450), (4, 'Roghni Naan · روغنی نان', 280), (2, 'Lassi · لسی', 500)])
    return page('Customer display raast', f'<div class="cd"><div class="cd-l"><h2>Token 57 · ٹوکن 57</h2>{rows}</div>{r}</div>', 'display', 'cs', dir_override='ltr')
