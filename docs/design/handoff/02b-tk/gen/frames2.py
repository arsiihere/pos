from frames import frame, kiosk, QTY
from core import *  # noqa
import core

# ====================================================================== CUSTOMER, PHONE-AHEAD, REPEAT


def keypad_pop():
    keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']
    b = ''.join(f'<button{" style=\"background:var(--action);color:var(--on-action)\"" if k == "OK" else ""}>{k}</button>' for k in keys)
    return f'<div class="tk-pop" style="top:178px; inset-inline-end:16px; width:300px" dir="ltr"><div class="tk-keypad">{b}</div></div>'


@frame('PhoneRepeat', 'TK-D01', 'kiosk', 'normal', 'Phone typed → match “Usman · 6 orders” → Repeat last order in one tap; numeric pad with +92 mask')
def _():
    return page('Phone repeat', kiosk(top(ctx=ctx_new()), queue(), menu(), cart('phone_match') .replace('</aside>', keypad_pop() + '</aside>')), 'kiosk')


@frame('PhoneInvalid', 'TK-D01', 'kiosk', 'error', 'Phone too short — inline error, Send still allowed without phone? No: a typed phone must be valid (clear it or fix it)')
def _():
    return page('Phone invalid', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart('phone_err')), 'kiosk')


@frame('PickupLater', 'TK-D02', 'kiosk', 'normal', 'Phone-ahead order — pickup 2:00 PM; name + phone required; kitchen times it to land at 2:00; “Schedule for 2:00 PM”')
def _():
    return page('Pickup later', kiosk(top(ctx=('phone', f'{t("ctx.phone_order")} · {nm("Saima")}', t('ctx.token_after'))), queue(), menu(qtys={'mk': 1, 'naan': 8, 'raita': 2, 'cold': 1}), cart('later')), 'kiosk')


@frame('PickupLaterUrdu', 'TK-D02', 'kiosk', 'urdu', 'Phone-ahead order in Urdu', 'ur')
def _():
    return page('فون آرڈر', kiosk(top(ctx=('phone', f'{t("ctx.phone_order")} · {nm("Saima")}', t('ctx.token_after'))), queue(), menu(qtys={'mk': 1, 'naan': 8, 'raita': 2, 'cold': 1}), cart('later')), 'kiosk')


# ====================================================================== ITEMS


def opt(name, price, n=0, off=None):
    cls = 'tk-opt' + (' is-sel' if n else '') + (' tk-opt--off' if off else '')
    sub = f'<small>{off}</small>' if off else f'<small dir="ltr">+ Rs {price:,} {"each" if not ur() else "فی"}</small>'
    ctl = stepper(n, sm=True) if not off else chip(t('m.sold_out'), 'danger')
    return f'<div class="{cls}"><div class="tk-opt__n"><b>{name}</b>{sub}</div>{ctl}</div>'


def choice(name, sel=False):
    return f'<button class="tk-var{" is-sel" if sel else ""}" style="min-height:60px">{name}</button>'


def item_sheet(edit=False, kg=False):
    vsel = 'kg' if kg else 'half'
    vars_ = [('half', t('m.half'), 1450, '22'), ('full', t('m.full'), 2700, '24'), ('kg', t('m.kg'), 2600, '24')]
    vh = ''.join(f'<button class="tk-var{" is-sel" if k == vsel else ""}">{lab}<small><span dir="ltr">Rs {p:,}</span>{" / kg" if k == "kg" else ""} · {num(m)} {"min" if not ur() else "منٹ"}</small></button>' for k, lab, p, m in vars_)
    naan_n = 4
    body = [f'<div><div class="tk-og__h"><b>{"Size" if not ur() else "سائز"}</b>{chip("Pick 1" if not ur() else "1 چنیں", "brand")}</div><div class="tk-vars">{vh}</div></div>']
    if kg:
        chips = ''.join(f'<button class="{"is-sel" if w == "0.75" else ""}" dir="ltr">{w} kg</button>' for w in ['0.5', '0.75', '1', '1.5', '2'])
        body.append(f'<div class="row" style="align-items:stretch; gap:16px"><div class="col" style="flex:1; gap:10px"><div class="tk-og__h"><b>{"Weight" if not ur() else "وزن"}</b>{chip("50 g steps" if not ur() else "50 گرام", "")}</div><div class="tk-tendered" style="margin:0"><span>{"Weight" if not ur() else "وزن"}</span><span class="money" dir="ltr">0.75 kg</span></div><div class="tk-pick">{chips}</div><button class="tk-btn">{ico("clock")}{"Weigh later — price after weighing" if not ur() else "بعد میں تولیں — قیمت تولنے کے بعد"}</button></div><div style="width:300px" dir="ltr"><div class="tk-keypad">{"".join(f"<button>{k}</button>" for k in ["1","2","3","4","5","6","7","8","9",".","0","⌫"])}</div></div></div>')
    body.append(f'<div><div class="tk-og__h"><b>{"With it" if not ur() else "ساتھ میں"}</b>{chip("Any amount" if not ur() else "جتنے چاہیں", "")}<span class="muted" style="margin-inline-start:auto; font-weight:700">{ico("info", "ico ico--sm")} {"Half karahi usually: 4 naan" if not ur() else "آدھی کڑاہی کے ساتھ عموماً 4 نان"}</span></div>'
                f'<div class="tk-opts">{opt(iname("rnaan"), 70, naan_n)}{opt(iname("naan"), 40, 0)}{opt(iname("raita"), 120, 1)}{opt(iname("salad"), 100, 0)}{opt(iname("roti"), 25, 0)}{opt("Extra gravy" if not ur() else "اضافی شوربہ", 150, 0, off=("Kitchen turned it off" if not ur() else "کچن نے بند کیا"))}</div></div>')
    body.append(f'<div><div class="tk-og__h"><b>{"Cooking" if not ur() else "پکانا"}</b>{chip("Pick up to 2" if not ur() else "2 تک چنیں", "")}</div><div class="tk-grid3" style="grid-template-columns:repeat(4,1fr)">{choice("Less oil" if not ur() else "کم تیل", True)}{choice("Extra spicy" if not ur() else "زیادہ مرچ")}{choice("Mild" if not ur() else "کم مرچ")}{choice("No tomato" if not ur() else "ٹماٹر کے بغیر")}</div></div>')
    if not kg:
        body.append(f'<div class="tk-note">{ico("note")}<span class="tk-note__t muted">{"Kitchen note (80)" if not ur() else "کچن نوٹ (80)"}</span><button class="tk-btn" style="min-height:44px">{ico("plus", "ico ico--sm")}{t("c.note_add")}</button></div>')
    total = (2600 * 0.75 if kg else 1450) + 280 + 120
    cta = ('Save changes' if not ur() else 'تبدیلی محفوظ کریں') if edit else ('Add to order' if not ur() else 'آرڈر میں ڈالیں')
    rm = f'<button class="tk-btn tk-btn--lg" style="color:var(--danger)">{ico("trash")}{"Remove" if not ur() else "ہٹائیں"}</button>' if edit else ''
    sub = f'{"Ready by" if not ur() else "تیار ہوگا"} {tm("1:42 PM")} · {"karahi station 2 of 3 busy" if not ur() else "کڑاہی اسٹیشن: 3 میں سے 2 مصروف"}'
    return f'''<div class="tk-scrim"></div><div class="tk-sheet"><div class="tk-sheet__h"><span class="tk-ph" style="width:64px;height:64px;--ph1:#E07A2E;--ph2:#7A2A0C"></span><div><h2>{iname("ck")}</h2><small>{sub}</small></div><button class="tk-x" aria-label="Close">{ico("x")}</button></div>
<div class="tk-sheet__b">{"".join(body)}</div>
<div class="tk-sheet__f">{rm}<span class="row" style="gap:10px"><span class="tk-pick__l">{"Qty" if not ur() else "تعداد"}</span>{stepper(1)}</span><button class="tk-btn tk-btn--xl tk-btn--primary">{cta} · {money(int(total))} {kbd("Enter")}</button></div></div>'''


@frame('ItemSheet', 'TK-D03', 'kiosk', 'normal', 'Item sheet — size, add-ons WITH quantity steppers (karahi + 4 naan), cooking choices, note; “usually 4 naan” hint')
def _():
    return page('Item sheet', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()) + item_sheet(), 'kiosk')


@frame('ItemSheetEdit', 'TK-D03', 'kiosk', 'edit', 'Editing a cart line — CTA says “Save changes”, Remove on the left (fixes “Add to order” on edit)')
def _():
    return page('Item edit', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart(sel='ck')) + item_sheet(edit=True), 'kiosk')


@frame('ItemSheetKg', 'TK-D03', 'kiosk', 'normal', 'Karahi by kg — weight pad, 0.5/0.75/1 kg chips, or Weigh later')
def _():
    return page('Item kg', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()) + item_sheet(kg=True), 'kiosk')


@frame('ItemSheetUrdu', 'TK-D03', 'kiosk', 'urdu', 'Item sheet in Urdu', 'ur')
def _():
    return page('آئٹم', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()) + item_sheet(), 'kiosk')


@frame('DealSheet', 'TK-D04', 'kiosk', 'normal', 'Family deal — each part listed, choices as big buttons, extra naan with a stepper')
def _():
    parts = f'''<div><div class="tk-og__h"><b>{"In this deal" if not ur() else "اس ڈیل میں"}</b></div>
<div class="tk-grid2">{''.join(f'<div class="tk-il"><span class="tk-il__q num">{q}×</span><div class="tk-il__n"><b>{n}</b><small>{s}</small></div>{chip(t("m.now"), "ok", "check") if s == "" else ""}</div>' for q, n, s in [(1, iname("ck") + " · " + t("m.full"), "24 min"), (6, iname("rnaan"), "6 min"), (2, iname("raita"), ""), (1, iname("salad"), "")])}</div></div>
<div><div class="tk-og__h"><b>{"Drinks — pick 4" if not ur() else "مشروب — 4 چنیں"}</b>{chip("4 of 4", "ok", "check")}</div><div class="tk-opts">{opt(iname("lassi"), 0, 2)}{opt(iname("slassi"), 0, 1)}{opt(iname("cold"), 0, 1)}{opt(iname("water"), 0, 0)}</div></div>
<div><div class="tk-og__h"><b>{"Extra naan" if not ur() else "اضافی نان"}</b>{chip("Any amount", "")}</div><div class="tk-opts">{opt(iname("rnaan"), 70, 2)}{opt(iname("naan"), 40, 0)}</div></div>'''
    sheet = f'''<div class="tk-scrim"></div><div class="tk-sheet"><div class="tk-sheet__h"><span class="tk-ph" style="width:64px;height:64px;--ph1:#E07A2E;--ph2:#7A2A0C"></span><div><h2>Family Deal</h2><small>{"Ready by" if not ur() else "تیار ہوگا"} {tm("1:44 PM")}</small></div><button class="tk-x">{ico("x")}</button></div>
<div class="tk-sheet__b">{parts}</div><div class="tk-sheet__f"><span class="row" style="gap:10px"><span class="tk-pick__l">Qty</span>{stepper(1)}</span><button class="tk-btn tk-btn--xl tk-btn--primary">Add to order · {money(3340)} {kbd("Enter")}</button></div></div>'''
    return page('Deal', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()) + sheet, 'kiosk')


@frame('TileStates', 'TK-C01', 'component', 'all', 'Menu tile — every state: wait chip, now, zone count, in cart, keyboard focus, sold out (no strike-through), not now, paused, half/full on tile, rush tile')
def _():
    cells = [
        ('Normal — wait in minutes', tile('tawa')), ('Ready now (pre-cooked)', tile('paye', zone=18)), ('In cart (qty badge)', tile('rnaan', qty=4, sel=True)),
        ('Long wait ≥ 20 min = amber', tile('mk', split=True)), ('Keyboard focus (Enter adds)', tile('rnaan', kb=True)),
        ('Sold out — label, price NOT struck through; tap shows why', tile('tikka', off=t('m.sold_out'))),
        ('Not now (hours)', tile('tikki', off=t('m.not_now'))), ('Station paused', tile('naan', off=t('m.paused'))),
        ('Low stock', tile('maghaz').replace(chip(t('m.now'), 'ok', 'check'), chip(t('m.left', n=num(3)), 'warn'))),
    ]
    h = ['<div class="cmp col" style="gap:24px; padding:40px; flex:1"><h1>Menu tile — states (TK-C01)</h1><div class="cmp-grid">']
    for lbl, html in cells:
        h.append(f'<div><div style="width:300px">{html}</div><div class="lbl">{lbl}</div></div>')
    h.append(f'<div><div style="width:300px"><div class="tk-grid tk-grid--rush" style="grid-template-columns:1fr">{tile("ck", split=True, qty=1)}</div></div><div class="lbl">Rush tile — no photo, Half / Full right on the tile (1 tap)</div></div>')
    h.append(f'<div style="grid-column:span 2"><div class="tk-toast" style="position:static">{ico("warn")}{t("t.sold_out")}</div><div class="lbl">Tap on an off tile → toast with the reason (never silent)</div></div>')
    h.append('</div></div>')
    return page('Tiles', ''.join(h), 'sheet', 'cmp')


@frame('KeyboardMode', 'TK-S02', 'kiosk', 'normal', 'Keyboard speed mode — type “4n”, Enter adds 4 roghni naan; shortcuts always shown')
def _():
    return page('Keyboard', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys={'paye': 2, 'ck': 1}, search='4n', sugg=True), cart()), 'kiosk')


@frame('CartTimeDelta', 'TK-S02', 'kiosk', 'normal', 'USP — 2nd karahi pushes Ready by from 1:42 to 2:00 PM; the line says why, so the cashier can tell the customer')
def _():
    return page('Time delta', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys={'paye': 2, 'raita': 1, 'ck': 2, 'lassi': 2}), cart('delta')), 'kiosk')


@frame('CartSuggest', 'TK-S02', 'kiosk', 'normal', 'Companion suggestions — under Half karahi: “+4 Roghni naan” “+Salad” (one tap each)')
def _():
    return page('Suggest', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys={'paye': 2, 'raita': 1, 'ck': 1, 'lassi': 2}), cart('sugg')), 'kiosk')


@frame('CartNote', 'TK-S02', 'kiosk', 'normal', 'Order note visible in the cart (saffron), button reads “Edit note”')
def _():
    return page('Note', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart('note')), 'kiosk')


@frame('ServeChoice', 'TK-S02', 'kiosk', 'normal', 'Mixed order — one plain question in the footer: “Paye is ready now. Give it now?” (replaces Together / As ready jargon)')
def _():
    return page('Serve', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart('serve')), 'kiosk')


# ====================================================================== SEND & PAY


NEW57 = dict(tok=57, who='Usman', items=[('ck', 1, 'Half'), ('rnaan', 4), ('paye', 2), ('lassi', 2)], time='1:42 PM', pay='paid')


@frame('SentToast', 'TK-D05', 'kiosk', 'normal', 'After Send — no dialog: fresh cart at once, token 57 toast (print again), token on top of Cooking')
def _():
    return page('Sent', kiosk(top(ctx=ctx_new()), queue(with_new=NEW57, sel=57), menu(), cart('empty')) + sent_toast(), 'kiosk')


@frame('SentQueued', 'TK-D05', 'kiosk', 'offline', 'Sent while offline — “Not sent yet — token comes when the hub is back”; row dashed “Waiting to send”')
def _():
    b = f'<div class="tk-banner tk-banner--danger">{ico("wifioff")}Hub offline since 1:18 PM — 1 order waiting to send.</div>'
    toast = f'<div class="tk-toast" style="bottom:24px; inset-inline-start:456px; width:760px; background:var(--warn-fill)">{ico("clock")}<span class="grow">{t("t.queued")}</span></div>'
    return page('Queued', kiosk(top(ctx=ctx_new(), live='off', req=0), queue('offline', queued_row=True), menu(), cart('empty'), banner=b) + toast, 'kiosk')


def pay_panel(mode='cash', given=5000, due=3650, state='enter', tok=57):
    head = f'<div class="tk-pay__h"><span class="tk-tok" dir="ltr">{tok}</span><div class="grow"><b style="font-size:20px">{t("p.title")}</b><div class="muted">{nm("Usman")} · {t("t.sent")} {tm("1:42 PM")}</div></div><button class="tk-x">{ico("x")}</button></div>'
    due_h = f'<div class="tk-pay__due"><span>{t("p.due")}</span>{money(due)}</div>'
    modes = f'<div class="tk-modes">' + ''.join(f'<button class="tk-mode{" is-sel" if mode == k else ""}">{ico(i, "ico ico--lg")}{t(key)}</button>' for k, i, key in [('cash', 'cash', 'p.cash'), ('card', 'card', 'p.card'), ('raast', 'qr', 'p.raast')]) + '</div>'
    if state == 'done':
        body = f'''<div class="tk-empty" style="flex:1; gap:16px"><div class="tk-empty__ic" style="width:120px;height:120px;background:var(--ok-fill);color:#fff">{ico("check", "ico", "width:64px;height:64px")}</div><b style="font-size:30px">{t("p.paid_t")} · {money(due)}</b>
<div class="tk-change" style="margin:0; width:100%"><span>{t("p.change_big")}</span>{money(given - due)}</div><p>{ico("print", "ico ico--sm")} {t("p.receipt")}</p></div>
<div class="tk-foot"><button class="tk-btn tk-btn--xl tk-btn--block tk-btn--primary">{t("p.next")} {kbd("Enter")}</button></div>'''
        return f'<div class="tk-paypanel">{head}{body}</div>'
    if state == 'error':
        body = f'''{due_h}{modes}<div class="tk-dlg" style="position:static; transform:none; width:auto; margin:16px; box-shadow:none; background:var(--danger-tint)"><h2 style="color:var(--danger)">{ico("warn")} {t("p.err")}</h2><p>{t("p.err_sub")}</p><p class="mono" style="font-size:14px">PAYMENT_EXCEEDS_BALANCE? no · card declined (Paymob 05)</p></div>
<div class="grow"></div><div class="tk-foot"><div class="tk-acts"><button class="tk-btn tk-btn--lg">{t("p.later")}</button><button class="tk-btn tk-btn--xl tk-btn--primary">{"Try again" if not ur() else "دوبارہ"}</button></div></div>'''
        return f'<div class="tk-paypanel">{head}{body}</div>'
    if mode == 'cash':
        notes = [('exact', t('p.exact'), due), ('4000', None, 4000), ('5000', None, 5000), ('10000', None, 10000)]
        nb = ''.join(f'<button class="{"is-sel" if v == given else ""}">{lab if lab else ""}<span dir="ltr">{"" if lab else "Rs "}{v:,}</span></button>' if not lab else f'<button class="{"is-sel" if v == given else ""}">{lab}<small dir="ltr">Rs {v:,}</small></button>' for k, lab, v in notes)
        short = given < due
        ch = f'<div class="tk-change{" tk-change--short" if short else ""}"><span>{t("p.short") if short else t("p.change")}</span>{money(abs(given - due))}</div>'
        body = f'''{due_h}{modes}<div class="tk-sec" style="padding:14px 16px 4px">{t("p.given")}</div><div class="tk-notes">{nb}</div>
<div class="tk-tendered" style="margin-top:10px"><span>{t("p.given")}</span>{money(given)}</div><div style="height:10px"></div>{ch}
<div class="grow"></div><div class="tk-foot"><div class="tk-acts"><button class="tk-btn tk-btn--lg">{t("p.later")}</button><button class="tk-btn tk-btn--xl tk-btn--ok">{ico("check")}{t("p.done")} {kbd("Enter")}</button></div></div>'''
    elif mode == 'card':
        body = f'''{due_h}{modes}<div style="height:14px"></div><div class="tk-qrbox" style="align-items:stretch; text-align:start"><b style="font-size:19px">{ico("card")} {t("p.machine")}</b>
<div class="tk-field"><label>{t("p.ref")}</label><div class="tk-input is-focus" dir="ltr"><span>4417</span></div></div><span class="muted">Kiosk has no NFC: card is taken on the counter machine or on a tablet (frame PayNfcTablet).</span></div>
<div class="grow"></div><div class="tk-foot"><div class="tk-acts"><button class="tk-btn tk-btn--lg">{t("p.later")}</button><button class="tk-btn tk-btn--xl tk-btn--ok">{ico("check")}{t("p.done")}</button></div></div>'''
    else:
        qr = qr_svg()
        body = f'''{due_h}{modes}<div style="height:14px"></div><div class="tk-qrbox"><div class="tk-qr-img">{qr}</div><b style="font-size:19px">{t("p.qr_t")}</b><span class="muted">{ico("clock", "ico ico--sm")} {t("p.qr_wait")}</span><span class="tk-chip tk-chip--info">{ico("tv", "ico ico--sm")} Also on the customer screen</span></div>
<div class="grow"></div><div class="tk-foot"><button class="tk-btn tk-btn--lg tk-btn--block">{t("p.later")}</button></div>'''
    return f'<div class="tk-paypanel">{head}{body}</div>'


def qr_svg(size=232, seed=7):
    import random
    r = random.Random(seed)
    n = 29
    c = size / n
    rects = []
    for y in range(n):
        for x in range(n):
            finder = (x < 7 and y < 7) or (x > n - 8 and y < 7) or (x < 7 and y > n - 8)
            if finder:
                fx, fy = (x if x < 7 else x - (n - 7)), (y if y < 7 else y - (n - 7))
                on = fx in (0, 6) or fy in (0, 6) or (2 <= fx <= 4 and 2 <= fy <= 4)
            else:
                on = r.random() < 0.48
            if on:
                rects.append(f'<rect x="{x * c:.1f}" y="{y * c:.1f}" width="{c + .4:.1f}" height="{c + .4:.1f}"/>')
    return f'<svg viewBox="0 0 {size} {size}" width="100%" height="100%" fill="#111">{"".join(rects)}</svg>'


@frame('PayCash', 'TK-D06', 'kiosk', 'normal', 'Send & pay → pay panel over the cart (menu + queue stay live): Exact / 4,000 / 5,000 / 10,000, change shown huge')
def _():
    return page('Pay cash', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel())), 'kiosk')


@frame('PayCashShort', 'TK-D06', 'kiosk', 'error', 'Typed less than due — “Short by Rs 650” in red, Paid stays off')
def _():
    return page('Pay short', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel(given=3000).replace('tk-btn--ok"', 'tk-btn--ok" aria-disabled="true"'))), 'kiosk')


@frame('PayCard', 'TK-D06', 'kiosk', 'normal', 'Card on the kiosk — counter machine, last 4 digits as the reference (05 reference_required)')
def _():
    return page('Pay card', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel('card'))), 'kiosk')


@frame('PayRaast', 'TK-D06', 'kiosk', 'normal', 'Raast — dynamic QR for this amount; closes itself when the bank confirms; mirrored on the customer screen')
def _():
    return page('Pay raast', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel('raast'))), 'kiosk')


@frame('PayDone', 'TK-D06', 'kiosk', 'normal', 'Paid — change Rs 1,350 huge, receipt printing, Enter = next customer (fresh cart already behind)')
def _():
    return page('Pay done', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.paid_t'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel(state='done'))), 'kiosk')


@frame('PayError', 'TK-D06', 'kiosk', 'error', 'Payment failed — nothing charged, Try again or Pay later (order is already in the kitchen)')
def _():
    return page('Pay error', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel('card', state='error'))), 'kiosk')


@frame('PayUrdu', 'TK-D06', 'kiosk', 'urdu', 'Pay panel in Urdu', 'ur')
def _():
    return page('پیسے', kiosk(top(ctx=('bag', f'Token 57 · {nm("Usman")}', t('p.title'))), queue(with_new=NEW57, sel=57), menu(), cart(overlay=pay_panel())), 'kiosk')


# ====================================================================== TOKEN VIEW (drawer over menu + cart)


def il(q, name, sub, stage, sel=False):
    tone = {'ready': ('ok', 'checkc', t('v.ready')), 'cooking': ('warn', 'pot', t('v.cooking')), 'waiting': ('', 'clock', t('v.waiting')), 'given': ('', 'hand', t('v.given'))}[stage]
    cls = 'tk-il' + (' tk-il--done' if stage == 'given' else '') + (' is-sel' if sel else '')
    return f'<div class="{cls}"><span class="tk-il__q num">{q}×</span><div class="tk-il__n"><b>{name}</b><small>{sub}</small></div>{chip(tone[2], tone[0], tone[1], lg=True)}</div>'


def token_drawer(kind='due'):
    if kind == 'due':
        tok, who, ph, pay, ready = 54, None, False, ('due', 1800), '1:24 PM'
        lines = il(2, iname('paye'), t('c.counter'), 'ready') + il(2, iname('lassi'), f'{t("v.ready_at")} {tm("1:24 PM")}', 'cooking')
        primary = f'<button class="tk-btn tk-btn--xl tk-btn--primary">{ico("cash")}{t("v.pay")} · {money(1800)} {kbd("F8")}</button>'
    elif kind == 'ready':
        tok, who, ph, pay, ready = 48, 'Ali', True, ('paid', 2050), '1:12 PM'
        lines = il(1, f'{t("m.full")} {iname("ck")}', 'Less oil', 'ready') + il(6, iname('rnaan'), '', 'ready') + il(1, iname('raita'), t('c.counter'), 'ready')
        primary = f'<button class="tk-btn tk-btn--xl tk-btn--ok">{ico("hand")}{t("v.collected")} {kbd("Enter")}</button>'
    elif kind == 'part':
        tok, who, ph, pay, ready = 52, 'Ayesha', True, ('paid', 2950), '1:31 PM'
        lines = il(2, iname('paye'), t('c.counter'), 'given') + il(1, f'{t("m.half")} {iname("ck")}', '', 'cooking') + il(4, iname('rnaan'), f'{t("v.ready_at")} {tm("1:31 PM")}', 'waiting')
        primary = f'<button class="tk-btn tk-btn--xl" aria-disabled="true">{ico("clock")}{t("v.collected")} · {tm("1:31 PM")}</button>'
    else:  # late
        tok, who, ph, pay, ready = 46, 'Kamran', True, ('paid', 1650), '1:03 PM'
        lines = il(1, iname('tawa'), '', 'ready') + il(4, iname('roti'), '', 'ready') + il(1, iname('salad'), t('c.counter'), 'ready')
        primary = f'<button class="tk-btn tk-btn--xl tk-btn--ok">{ico("hand")}{t("v.collected")} {kbd("Enter")}</button>'
    paid = pay[0] == 'paid'
    who_h = nm(who) if who else t('shell.tab.takeaway')
    late = f'<div class="tk-banner tk-banner--warn" style="border-radius:14px">{ico("phone")}{t("v.late")}<button class="tk-btn tk-btn--primary">{ico("phone")}{t("v.call")} · <span dir="ltr">0300 ••• 4567</span></button></div>' if kind == 'late' else ''
    give = f'<button class="tk-btn tk-btn--lg">{ico("hand")}{t("v.give_ready")} · {num(2)}× {iname("paye")}</button>' if kind == 'due' else ''
    secondary = f'''<div class="tk-grid3"><button class="tk-btn">{ico("plus")}{t("v.add")}</button><button class="tk-btn">{ico("trash")}{t("v.remove")}</button><button class="tk-btn">{ico("print")}{t("v.print")}</button>
{f'<button class="tk-btn">{ico("phone")}{t("v.call")}</button>' if ph else '<button class="tk-btn" aria-disabled="true">' + ico("phone") + t("v.call") + '</button>'}<button class="tk-btn">{ico("bolt")}{t("v.hurry")}</button>{('<button class="tk-btn">' + ico("cash") + t("v.pay") + '</button>') if not paid else '<button class="tk-btn">' + ico("bill") + t("v.bill") + '</button>'}</div>'''
    return f'''<div class="tk-scrim" style="left:440px"></div><div class="tk-drawer" role="dialog">
<div class="tk-drawer__h"><span class="tk-tv__tok" dir="ltr">{tok}</span><div class="tk-tv__who"><b>{who_h}</b><small>{t("v.placed", t=tm("1:0" + str(tok % 10) + " PM"), who=nm("Sana"))}</small></div><button class="tk-x">{ico("x")}</button></div>
<div class="tk-drawer__b">{late}
<div class="tk-facts"><div class="tk-fact"><small>{t("v.ready_at")}</small><b dir="ltr">{ready}</b></div><div class="tk-fact {"tk-fact--paid" if paid else "tk-fact--due"}"><small>{t("v.bill")}</small><b>{t("q.paid") if paid else t("q.due")} · {money(pay[1])}</b></div><div class="tk-fact"><small>{t("c.phone")}</small><b dir="ltr">{"0300 ••• 4567" if ph else "—"}</b></div></div>
<div class="col" style="gap:8px">{lines}</div></div>
<div class="tk-drawer__f">{give}{primary}{secondary}</div></div>'''


@frame('TokenDue', 'TK-S03', 'kiosk', 'normal', 'Token view (drawer) — 54 unpaid: stages per item, Give ready items now, Take payment as the primary')
def _():
    return page('Token due', kiosk(top(ctx=('bag', 'Token 54', f'{t("q.due")} · Rs 1,800'), back=True), queue(sel=54), menu(), cart()) + token_drawer('due'), 'kiosk')


@frame('TokenReady', 'TK-S03', 'kiosk', 'normal', 'Token 48 ready + paid — one primary: Hand over all (Enter); undo for 5 s after')
def _():
    return page('Token ready', kiosk(top(ctx=('bag', f'Token 48 · {nm("Ali")}', t('q.paid')), back=True), queue(sel=48), menu(), cart()) + token_drawer('ready'), 'kiosk')


@frame('TokenPartial', 'TK-S03', 'kiosk', 'normal', 'Split pickup — paye handed over, karahi cooking; Hand over waits for 1:31 PM')
def _():
    return page('Token partial', kiosk(top(ctx=('bag', f'Token 52 · {nm("Ayesha")}', t('q.paid')), back=True), queue(sel=52), menu(), cart()) + token_drawer('part'), 'kiosk')


@frame('TokenLate', 'TK-S03', 'kiosk', 'normal', 'Not collected — ready 17 min ago: amber, Call shows the phone (view-customer-contact)')
def _():
    return page('Token late', kiosk(top(ctx=('bag', f'Token 46 · {nm("Kamran")}', t('q.paid')), back=True), queue(sel=46), menu(), cart()) + token_drawer('late'), 'kiosk')


@frame('TokenUrdu', 'TK-S03', 'kiosk', 'urdu', 'Token view in Urdu', 'ur')
def _():
    return page('ٹوکن', kiosk(top(ctx=('bag', 'Token 54', f'{t("q.due")} · Rs 1,800'), back=True), queue(sel=54), menu(), cart()) + token_drawer('due').replace('left:440px', 'right:440px'), 'kiosk')


@frame('TokenAddItems', 'TK-S03', 'kiosk', 'normal', 'Add items to a sent token — same token 53, banner says so, primary “Add to token 53”')
def _():
    return page('Add items', kiosk(top(ctx=('plus', f'{t("ctx.adding")} 53 · {nm("Bilal")}', f'{t("q.paid")} · Rs 2,730'), back=True), queue(sel=53), menu(qtys={'rnaan': 2, 'slassi': 1}), cart('add_to')), 'kiosk')


@frame('TokenRemove', 'TK-D07', 'kiosk', 'normal', 'Remove / cancel — not started: remove (units stepper); cooking: void → approval (04); paid → refund on the bill')
def _():
    rows = (f'<div class="tk-il is-sel"><span class="tk-il__q num">2×</span><div class="tk-il__n"><b>{iname("lassi")}</b><small>{t("v.waiting")} · {"can be removed" if not ur() else "ہٹ سکتا ہے"}</small></div>{stepper(1, sm=True)}</div>'
            f'<div class="tk-il"><span class="tk-il__q num">2×</span><div class="tk-il__n"><b>{iname("paye")}</b><small>{t("v.ready")} · {"Void needs a manager" if not ur() else "منسوخی کیلئے مینیجر"}</small></div>{chip("Void · approval", "warn", "shield")}</div>')
    reasons = ''.join(f'<button class="tk-var" style="min-height:60px">{r}</button>' for r in ['Customer changed mind', 'Wrong item', 'Too long wait', 'Other'])
    dlg = f'''<div class="tk-scrim"></div><div class="tk-dlg" style="width:760px"><h2>{"Remove from token 54" if not ur() else "ٹوکن 54 سے ہٹائیں"}</h2>{rows}
<div><div class="tk-og__h"><b>Reason</b></div><div class="tk-grid2" style="grid-template-columns:repeat(4,1fr)">{reasons.replace('class="tk-var"', 'class="tk-var is-sel"', 1)}</div></div>
<p>{"Bill goes from Rs 1,800 to Rs 1,550. Not paid yet, so no refund." if not ur() else "بل 1,800 سے 1,550 ہو جائے گا۔"}</p>
<div class="tk-dlg__acts"><button class="tk-btn tk-btn--lg">{"Keep" if not ur() else "رہنے دیں"}</button><button class="tk-btn tk-btn--lg tk-btn--danger">{ico("trash")}{"Remove 1 lassi" if not ur() else "1 لسی ہٹائیں"}</button></div></div>'''
    return page('Remove', kiosk(top(ctx=('bag', 'Token 54', f'{t("q.due")} · Rs 1,800'), back=True), queue(sel=54), menu(), cart()) + dlg, 'kiosk')


# ====================================================================== HANDOVER, HELD, LEAVE


@frame('HandoverUndo', 'TK-C02', 'kiosk', 'normal', 'Hand over in one tap from the ready tile — toast “48 handed over · Undo” for 5 s; the board clears 48')
def _():
    toast = f'<div class="tk-toast tk-toast--ok" style="top:92px; left:456px">{ico("hand")}<span><b dir="ltr">48</b> {t("t.collected")}</span><button class="tk-btn">{t("t.undo")}</button></div>'
    import copy
    saved = core.READY[:]
    core.READY[:] = [r for r in saved if r['tok'] != 48]
    html = kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()) + toast
    core.READY[:] = saved
    return page('Handover', html, 'kiosk')


@frame('ReadyTiles', 'TK-C02', 'component', 'all', 'Ready tile — paid · due (tap = pay first) · waiting long (call) · partial (some given) · selected')
def _():
    cells = [('Paid → Hand over (1 tap + undo)', ready_tile(core.READY[0])), ('Due → Take payment first', ready_tile(core.READY[1])),
             ('Not collected 15+ min → amber, Call', ready_tile(core.READY[2])), ('Partial — paye given, karahi 1:31', ready_tile(core.READY[3])),
             ('Selected (drawer open)', ready_tile(core.READY[0], sel=True))]
    h = ['<div class="cmp col" style="gap:24px; padding:40px; flex:1"><h1>Ready tile — states (TK-C02)</h1><div class="cmp-grid" style="grid-template-columns:repeat(5,1fr)">']
    for lbl, html in cells:
        h.append(f'<div><div style="width:200px">{html}</div><div class="lbl">{lbl}</div></div>')
    h.append('</div><h1 style="margin-top:20px">Queue row — states</h1><div class="cmp-grid" style="grid-template-columns:repeat(3,1fr)">')
    rows = [('Cooking · paid', q_row(core.COOKING[0])), ('Cooking · due', q_row(core.COOKING[1])), ('Selected', q_row(core.COOKING[2], sel=True)),
            ('Waiting to send (offline)', q_row(dict(tok=0, who='Usman', items=[('ck', 1, 'Half')]), queued=True)), ('Phone order — later', later_row(core.LATER[0])), ('Phone order — paid', later_row(core.LATER[1]))]
    for lbl, html in rows:
        h.append(f'<div><div style="width:410px">{html}</div><div class="lbl">{lbl}</div></div>')
    h.append('</div></div>')
    return page('Ready tiles', ''.join(h), 'sheet', 'cmp')


@frame('LeaveGuard', 'TK-D08', 'kiosk', 'normal', 'Leaving with an unsent cart (any tab, Back, sign out) — Hold it / Throw away / Stay here. Never silent.')
def _():
    dlg = f'''<div class="tk-scrim"></div><div class="tk-dlg"><div class="row" style="gap:16px"><div class="tk-empty__ic" style="width:64px;height:64px;background:var(--warn-tint);color:var(--warn)">{ico("warn")}</div><h2>{t("l.title")}</h2></div>
<p style="font-size:19px; color:var(--ink)">{t("l.body", n=num(11), money=money(3650))}<br><span class="muted">{"Going to: Parking" if not ur() else "جا رہے ہیں: پارکنگ"} · {nm("Usman")}</span></p>
<button class="tk-btn tk-btn--xl tk-btn--primary">{ico("hold")}{t("l.hold")} {kbd("H")}</button>
<div class="tk-dlg__acts"><button class="tk-btn tk-btn--lg" style="color:var(--danger)">{ico("trash")}{t("l.discard")}</button><button class="tk-btn tk-btn--lg">{t("l.stay")} {kbd("Esc")}</button></div></div>'''
    return page('Leave guard', kiosk(top(ctx=ctx_new(name='Usman'), tab='parking'), queue(), menu(qtys=QTY), cart()) + dlg, 'kiosk')


@frame('HeldDrawer', 'TK-S04', 'kiosk', 'normal', 'Held on this counter — everyone signed in here sees them (not only who held); Resume / Throw away; held at + by whom')
def _():
    rows = ''
    for who, by, items, amt, at in [('Usman', 'Sana', 'Half karahi · 4 roghni naan · 2 paye', 3650, '1:16 PM'), ('—', 'Zain', '6 paye · 2 maghaz', 5700, '12:58 PM')]:
        rows += f'<div class="tk-il" style="min-height:88px"><span class="tk-tok tk-tok--q">{ico("hold")}</span><div class="tk-il__n"><b>{nm(who) if who != "—" else t("shell.tab.takeaway")} · {money(amt)}</b><small>{items}</small><small>{"Held" if not ur() else "ہولڈ"} {tm(at)} · {"by" if not ur() else ""} {nm(by)}</small></div><button class="tk-btn tk-btn--primary">{t("h.resume")}</button><button class="tk-btn tk-btn--quiet" style="color:var(--danger)">{ico("trash")}</button></div>'
    d = f'''<div class="tk-scrim" style="left:440px"></div><div class="tk-drawer"><div class="tk-drawer__h"><div class="tk-empty__ic" style="width:56px;height:56px">{ico("hold")}</div><h2>{t("h.title")} · {num(2)}</h2><button class="tk-x">{ico("x")}</button></div>
<div class="tk-drawer__b">{rows}<div class="tk-hint">{ico("info", "ico ico--sm")}{"Held orders are not in the kitchen. Resume one to send it." if not ur() else "ہولڈ آرڈر کچن میں نہیں گئے۔ بھیجنے کیلئے جاری رکھیں۔"}</div></div></div>'''
    return page('Held', kiosk(top(ctx=ctx_new()), queue(), menu(), cart('empty')) + d, 'kiosk')
