"""Frame building blocks for the 02b-TK takeaway hand-off. Pure string builders: every frame is static HTML at device
size, linking ds/pos/tokens.css + pulse-tk.css (no runtime, no CDN)."""
from strings import tr

L = 'en'  # current language, set per frame


def t(key, **kw):
    return tr(key, L, **kw)


def ur():
    return L == 'ur'


# ------------------------------------------------------------------ icons (24 box, stroke, Pulse line style)
P = {
    'back': ['M15 5l-7 7 7 7'],
    'fwd': ['M9 5l7 7-7 7'],
    'bag': ['M5 8h14l-1.2 12.5H6.2z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
    'car': ['M4 16v-4l2-5h12l2 5v4z', 'M4 16h16', 'M7.5 19.5v.01', 'M16.5 19.5v.01'],
    'tables': ['M4 9h16', 'M6 9v10', 'M18 9v10', 'M3 9l1.5-4h15L21 9'],
    'bill': ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
    'tray': ['M3.5 13.5l2.5-8h12l2.5 8V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z', 'M3.5 13.5h5l1 2.5h5l1-2.5h5'],
    'shield': ['M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
    'down': ['M6 9l6 6 6-6'],
    'search': ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-4-4'],
    'phone': ['M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4 5.5a2 2 0 0 1 2-2z'],
    'user': ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
    'plus': ['M12 5v14', 'M5 12h14'],
    'minus': ['M5 12h14'],
    'x': ['M6 6l12 12', 'M18 6L6 18'],
    'check': ['M5 12.5l4.5 4.5L19 7.5'],
    'checkc': ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.5l2.8 2.8L16 10'],
    'clock': ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    'send': ['M4 12l16-8-6 16-2.5-6.5z', 'M11.5 13.5L20 4'],
    'cash': ['M3 7h18v10H3z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 10v.01', 'M18 14v.01'],
    'card': ['M3 6h18v12H3z', 'M3 10h18', 'M7 15h4'],
    'qr': ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 18h2v2h-2z', 'M14 18h2', 'M18 14h2'],
    'nfc': ['M7 7c3 3 3 7 0 10', 'M11 5c4.5 4 4.5 10 0 14', 'M15 3c6 5 6 13 0 18'],
    'print': ['M7 9V3h10v6', 'M5 17H3v-7h18v7h-2', 'M7 14h10v7H7z'],
    'hold': ['M9 5v14', 'M15 5v14'],
    'note': ['M6 3h9l4 4v14H6z', 'M14 3v5h5', 'M9 13h7', 'M9 17h5'],
    'bolt': ['M13 2L4 14h7l-1 8 9-12h-7z'],
    'warn': ['M12 3l10 18H2z', 'M12 10v5', 'M12 18v.01'],
    'info': ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5v.01'],
    'kbd': ['M3 6h18v12H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M7 14h10'],
    'trash': ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    'edit': ['M4 20h4L19 9l-4-4L4 16z', 'M14 6l4 4'],
    'bell': ['M6 16V11a6 6 0 1 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
    'lock': ['M6 11h12v10H6z', 'M8 11V8a4 4 0 0 1 8 0v3'],
    'switch': ['M7 7h13l-3-3', 'M17 17H4l3 3'],
    'logout': ['M14 4h5v16h-5', 'M10 8l-4 4 4 4', 'M6 12h11'],
    'repeat': ['M4 12a7 7 0 0 1 12-5l2 2', 'M18 4v5h-5', 'M20 12a7 7 0 0 1-12 5l-2-2', 'M6 20v-5h5'],
    'flame': ['M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5'],
    'pot': ['M4 10h16l-1.5 9h-13z', 'M2 10h20', 'M9 6c0-1 1-1 1-2', 'M14 6c0-1 1-1 1-2'],
    'hand': ['M7 11V5a1.5 1.5 0 0 1 3 0v5', 'M10 10V4a1.5 1.5 0 0 1 3 0v6', 'M13 10V5a1.5 1.5 0 0 1 3 0v7', 'M16 12V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.5L7 14'],
    'wifioff': ['M2.5 8.5a14 14 0 0 1 6-3', 'M15.5 5.7a14 14 0 0 1 6 2.8', 'M8.5 15.5a5 5 0 0 1 7 0', 'M12 19v.01', 'M3 3l18 18'],
    'tv': ['M3 5h18v12H3z', 'M8 21h8', 'M12 17v4'],
    'star': ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'],
    'more': ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    'speaker': ['M4 9h4l5-4v14l-5-4H4z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'],
}


def ico(name, cls='ico', style=''):
    ds = ''.join(f'<path d="{d}"/>' for d in P[name])
    st = f' style="{style}"' if style else ''
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true"{st}>{ds}</svg>'


def money(n, cls='money'):
    return f'<span class="{cls}" dir="ltr">Rs {n:,}</span>'


def tm(s, cls='time'):
    return f'<span class="{cls}" dir="ltr">{s}</span>'


def num(s, cls='num'):
    return f'<span class="{cls}" dir="ltr">{s}</span>'


def chip(text, tone='', icon=None, lg=False):
    c = 'tk-chip' + (f' tk-chip--{tone}' if tone else '') + (' tk-chip--lg' if lg else '')
    return f'<span class="{c}">{ico(icon) if icon else ""}{text}</span>'


def kbd(k):
    return f'<span class="tk-kbd" dir="ltr">{k}</span>'


# ------------------------------------------------------------------ data (Arif Chatkhara, Lake City, lunch 1:20 PM)
NAMES = {
    'Usman': 'عثمان', 'Ali': 'علی', 'Bilal': 'بلال', 'Hamza': 'حمزہ', 'Saima': 'صائمہ', 'Ayesha': 'عائشہ', 'Kamran': 'کامران',
    'Imran': 'عمران', 'Sana': 'ثنا', 'Zain': 'زین', 'Hira': 'حرا', 'Faisal': 'فیصل', 'Nadia': 'نادیہ', 'Owais': 'اویس',
}


def nm(n):
    return NAMES.get(n, n) if ur() else n


ITEMS = {  # key: (en, ur, price, wait, colours)
    'paye': ('Paye', 'پائے', 650, 'now', ('#C9894A', '#5A2A10')),
    'maghaz': ('Maghaz', 'مغز', 900, 'now', ('#E6C39A', '#8A5A2E')),
    'ck': ('Chicken Karahi', 'چکن کڑاہی', 1450, 22, ('#E07A2E', '#7A2A0C')),
    'mk': ('Mutton Karahi', 'مٹن کڑاہی', 2400, 28, ('#B5481E', '#4E1606')),
    'tawa': ('Tawa Piece', 'توا پیس', 1100, 14, ('#9E4A22', '#3E1406')),
    'tikki': ('Anda Tikki', 'انڈا ٹکی', 120, 4, ('#F0C048', '#A8661A')),
    'qeema': ('Beef Qeema', 'بیف قیمہ', 900, 10, ('#8E3B1C', '#3A1206')),
    'seekh': ('Seekh Kabab ×4', 'سیخ کباب ×4', 800, 15, ('#A0522D', '#40180A')),
    'tikka': ('Chicken Tikka', 'چکن تکہ', 650, 18, ('#E46A2A', '#7A2408')),
    'naan': ('Naan', 'نان', 40, 5, ('#F1D9A8', '#B98340')),
    'rnaan': ('Roghni Naan', 'روغنی نان', 70, 6, ('#EED096', '#B57A30')),
    'roti': ('Roti', 'روٹی', 25, 4, ('#E9CFA0', '#A87838')),
    'lassi': ('Lassi · sweet', 'میٹھی لسی', 250, 2, ('#FFF6E0', '#E8D3A6')),
    'slassi': ('Lassi · salted', 'نمکین لسی', 250, 2, ('#F4F7EE', '#CFD8C0')),
    'raita': ('Raita', 'رائتہ', 120, 'now', ('#F6F3EA', '#CFC6AE')),
    'salad': ('Salad', 'سلاد', 100, 'now', ('#8CC56A', '#2F6A1E')),
    'cold': ('Cold drink 1.5 L', 'کولڈ ڈرنک 1.5 لیٹر', 280, 'now', ('#3B2020', '#120606')),
    'water': ('Water 1.5 L', 'پانی 1.5 لیٹر', 100, 'now', ('#CFE6F5', '#6CA6CF')),
}


def iname(k):
    e, u, *_ = ITEMS[k]
    return u if ur() else e


CATS = [('top', 'Top now', 'ابھی سب سے زیادہ'), ('paye', 'Paye', 'پائے'), ('karahi', 'Karahi', 'کڑاہی'), ('tawa', 'Tawa', 'توا'),
        ('bbq', 'BBQ', 'بی بی کیو'), ('tandoor', 'Tandoor', 'تندور'), ('drinks', 'Drinks', 'مشروبات'), ('sides', 'Sides', 'سائیڈز'), ('deals', 'Deals', 'ڈیلز')]


# ------------------------------------------------------------------ page
def page(title, body, kind='kiosk', extra='', theme='light', dir_override=None):
    d = dir_override or ('rtl' if ur() else 'ltr')
    return f'''<!doctype html>
<html lang="{L}" dir="{d}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<link rel="stylesheet" href="ds/pos/tokens.css">
<link rel="stylesheet" href="pulse-tk.css">
</head>
<body>
<div class="fr fr--{kind} {extra}" data-theme="{theme}" dir="{d}" lang="{L}">
{body}
</div>
</body>
</html>
'''


# ------------------------------------------------------------------ shell — proposed
TABS = [('takeaway', 'bag', 'shell.tab.takeaway'), ('parking', 'car', 'shell.tab.parking'), ('dine_in', 'tables', 'shell.tab.dine_in'), ('cashier', 'bill', 'shell.tab.cashier')]


def top(ctx=None, live='on', clock='1:20 PM', back=False, tab='takeaway', req=1, inbox=2, me='Sana', menu=False, rush_n=None, tab_counts=None, show_tabs=True):
    tab_counts = tab_counts or {}
    h = ['<header class="tk-top">']
    if back:
        h.append(f'<button class="tk-btn tk-btn--chrome">{ico("back", "ico flip")}{t("shell.back")}</button>')
    if ctx:
        icon, title, sub = ctx
        h.append(f'<div class="tk-ctx"><span class="tk-ctx__ic">{ico(icon)}</span><div><b>{title}</b><small>{sub}</small></div></div>')
    if show_tabs:
        h.append('<nav class="tk-tabs" aria-label="Screens">')
        for k, ic, key in TABS:
            sel = ' is-sel' if k == tab else ''
            cur = ' aria-current="page"' if k == tab else ''
            cnt = f'<span class="tk-count num">{tab_counts[k]}</span>' if k in tab_counts else ''
            h.append(f'<button class="tk-tab{sel}"{cur}>{ico(ic)}{t(key)}{cnt}</button>')
        h.append('</nav>')
    h.append('<div class="tk-end">')
    if live == 'on' and rush_n:
        h.append(f'<span class="tk-live tk-live--rush">{t("shell.rush")} · {num(rush_n)}</span>')
    elif live == 'on':
        h.append(f'<span class="tk-live">{t("shell.live")}</span>')
    else:
        h.append(f'<span class="tk-live tk-live--off">{t("shell.offline")}</span>')
    h.append(f'<span class="tk-clock" dir="ltr">{clock}</span>')
    if req:
        h.append(f'<button class="tk-ibtn" aria-label="{t("shell.requests")}">{ico("shield")}<span class="tk-count num">{req}</span></button>')
    h.append(f'<button class="tk-ibtn" aria-label="{t("shell.inbox")}">{ico("tray")}' + (f'<span class="tk-count num">{inbox}</span>' if inbox else '') + '</button>')
    h.append(f'<button class="tk-me" aria-haspopup="menu"{" aria-expanded=\"true\"" if menu else ""}><span class="tk-av">{nm(me)[0]}</span>{nm(me)}{ico("down", "ico ico--sm")}</button>')
    h.append('</div></header>')
    return ''.join(h)


def me_menu():
    return f'''<div class="tk-pop" style="top:72px; inset-inline-end:12px;" role="menu">
<div class="tk-pop__h"><b>{nm("Sana")}</b><span class="muted">Cashier · Counter 1</span></div>
<button class="tk-mi is-hover" role="menuitem">{ico("switch")}<span>{t("shell.me.switch")}<small>{t("shell.me.switch_sub")}</small></span></button>
<button class="tk-mi" role="menuitem">{ico("lock")}<span>{t("shell.me.lock")}<small>{t("shell.me.lock_sub")}</small></span></button>
<button class="tk-mi" role="menuitem">{ico("cash")}<span>{t("shell.me.shift")}<small dir="ltr">Opened 7:02 AM · float Rs 5,000</small></span></button>
<button class="tk-mi tk-mi--danger" role="menuitem">{ico("logout", "ico flip")}<span>{t("shell.me.signout")}<small>{t("shell.me.signout_sub")}</small></span></button>
</div>'''


def ctx_new(phone=False, name=None):
    if name:
        return ('phone' if phone else 'bag', f'{t("ctx.new")} · {nm(name)}', t('ctx.token_after'))
    return ('phone' if phone else 'bag', t('ctx.new'), t('ctx.token_after'))


# ------------------------------------------------------------------ queue rail
READY = [
    dict(tok=48, who='Ali', kind='paid', sub='1:12 PM'),
    dict(tok=50, who=None, kind='due', amt=1190),
    dict(tok=46, who='Kamran', kind='late', mins=17),
    dict(tok=52, who='Ayesha', kind='part'),
]
COOKING = [
    dict(tok=53, who='Bilal', items=[('ck', 1, 'Half'), ('rnaan', 4)], time='1:31 PM', pay='paid'),
    dict(tok=54, who=None, items=[('paye', 2), ('lassi', 2)], time='1:24 PM', pay='due'),
    dict(tok=55, who='Hamza', items=[('tawa', 1), ('roti', 3)], time='1:35 PM', pay='paid'),
    dict(tok=56, who=None, items=[('seekh', 2), ('raita', 1)], time='1:38 PM', pay='paid'),
]
LATER = [
    dict(who='Saima', items=[('mk', 1, 'Full'), ('naan', 8)], time='2:00 PM', pay='due'),
    dict(who='Imran', items=[('ck', 2, 'Full'), ('rnaan', 10), ('cold', 2)], time='2:30 PM', pay='paid'),
]


def items_text(items):
    out = []
    for it in items:
        k, n = it[0], it[1]
        nmx = iname(k)
        if len(it) > 2:
            nmx = (t('m.half') if it[2] == 'Half' else t('m.full')) + ' ' + nmx
        out.append(f'{n}× {nmx}' if n > 1 else nmx)
    return ' · '.join(out)


def pay_chip(p):
    return chip(t('q.paid'), 'ok', 'check') if p == 'paid' else chip(t('q.due'), 'danger')


def ready_tile(r, sel=False):
    k = r['kind']
    s = ' is-sel' if sel else ''
    who = nm(r['who']) if r.get('who') else '—'
    if k == 'paid':
        return f'<button class="tk-rt{s}"><span class="tok" dir="ltr">{r["tok"]}</span>{chip(t("q.paid"), "ok", "check")}<span class="tk-rt__who">{who}</span><span class="tk-rt__act">{ico("hand", "ico ico--sm")}{t("q.collect")}</span></button>'
    if k == 'due':
        return f'<button class="tk-rt tk-rt--due{s}"><span class="tok" dir="ltr" style="color:var(--ink)">{r["tok"]}</span>{chip(t("q.due"), "solid-danger")}<span class="tk-rt__who">{money(r["amt"])}</span><span class="tk-rt__act">{ico("cash", "ico ico--sm")}{t("q.collect_pay")}</span></button>'
    if k == 'late':
        return f'<button class="tk-rt tk-rt--late{s}"><span class="tok" dir="ltr">{r["tok"]}</span>{chip(t("q.paid"), "ok", "check")}<span class="tk-rt__who">{who}</span><span class="tk-rt__act">{ico("phone", "ico ico--sm")}{t("q.waiting_min", n=num(r["mins"]))}</span></button>'
    return f'<button class="tk-rt tk-rt--part{s}"><span class="tok" dir="ltr" style="color:var(--ink)">{r["tok"]}</span>{chip(t("q.paid"), "ok", "check")}<span class="tk-rt__who">{who}</span><span class="tk-rt__act" style="color:var(--ink-muted)">{t("q.part")} {tm("1:31 PM")}</span></button>'


def q_row(c, sel=False, queued=False):
    s = ' is-sel' if sel else ''
    qd = ' tk-qr--q' if queued else ''
    who = nm(c['who']) if c.get('who') else ''
    tokc = 'tk-tok tk-tok--q' if queued else 'tk-tok'
    tok = '—' if queued else c['tok']
    title = who or t('shell.tab.takeaway')
    right = chip(t('q.waiting_send'), 'warn', 'clock') if queued else f'{tm(c["time"])}{pay_chip(c["pay"])}'
    return f'<button class="tk-qr{s}{qd}"><span class="{tokc}" dir="ltr">{tok}</span><span class="tk-qr__m"><b>{title}</b><small>{items_text(c["items"])}</small></span><span class="tk-qr__r">{right}</span></button>'


def later_row(c):
    title = f'{nm(c["who"])} · {items_text(c["items"])}'
    return f'<button class="tk-qr"><span class="tk-tok tk-tok--phone">{ico("phone")}</span><span class="tk-qr__m"><b>{title}</b><small>{items_text(c["items"])}</small></span><span class="tk-qr__r">{tm(c["time"])}{pay_chip(c["pay"])}</span></button>'


def queue(mode='normal', sel=None, search=None, with_new=None, queued_row=False):
    """mode: normal | empty | rush | offline | error"""
    cls = 'tk-q tk-q--compact' if mode == 'rush' else 'tk-q'
    sfocus = ' is-focus' if search else ''
    stext = f'<span style="color:var(--ink); font-weight:700" dir="auto">{search}</span>' if search else t('q.search')
    h = [f'<aside class="{cls}"><div class="tk-q__top"><div class="tk-search{sfocus}">{ico("search")}{stext}{kbd("/")}</div></div><div class="tk-q__scroll">']
    if mode == 'error':
        h.append(f'<div class="tk-empty" style="padding-top:80px"><div class="tk-empty__ic" style="background:var(--danger-tint); color:var(--danger)">{ico("warn")}</div><b>{t("q.failed")}</b><p>{t("q.as_of")} {tm("1:18 PM")}</p><button class="tk-btn tk-btn--lg">{t("q.retry")}</button></div>')
    elif mode == 'empty':
        h.append(f'<div class="tk-empty" style="padding-top:120px"><div class="tk-empty__ic">{ico("bag")}</div><b>{t("q.empty_t")}</b><p>{t("q.empty_p")}</p></div>')
    else:
        if mode == 'offline':
            h.append(f'<div class="tk-hint" style="margin-top:4px">{ico("wifioff")}<span>{t("q.as_of")} {tm("1:18 PM")}</span></div>')
        if mode == 'rush':
            ready = READY + [dict(tok=58, who='Zain', kind='paid'), dict(tok=60, who=None, kind='due', amt=740)]
        else:
            ready = READY
        h.append(f'<div class="tk-sec">{ico("checkc", "ico ico--sm")}{t("q.ready")}<span class="tk-chip tk-chip--ok num">{len(ready) if mode != "rush" else 9}</span></div>')
        h.append('<div class="tk-ready">' + ''.join(ready_tile(r, sel == r['tok']) for r in ready) + '</div>')
        if mode == 'rush':
            h.append(f'<div class="tk-sec" style="padding-top:4px"><span class="tk-sec__end">{t("q.more", n=num(3))}</span></div>')
        cook = COOKING
        if with_new:
            cook = [with_new] + COOKING
        h.append(f'<div class="tk-sec">{ico("pot", "ico ico--sm")}{t("q.cooking")}<span class="tk-chip num">{len(cook) if mode != "rush" else 27}</span></div>')
        if queued_row:
            h.append(q_row(dict(tok=0, who='Usman', items=[('ck', 1, 'Half'), ('rnaan', 4), ('paye', 2)]), queued=True))
        rows = cook if mode != 'rush' else cook + [dict(tok=59 + i, who=None, items=[('paye', 2)], time=f'1:{40 + i} PM', pay='paid') for i in range(3)]
        for c in rows:
            h.append(q_row(c, sel == c['tok']))
        if mode == 'rush':
            h.append(f'<div class="tk-sec"><span class="tk-sec__end">{t("q.more", n=num(20))}</span></div>')
        else:
            h.append(f'<div class="tk-sec">{ico("phone", "ico ico--sm")}{t("q.later")}<span class="tk-chip tk-chip--info num">2</span></div>')
            for c in LATER:
                h.append(later_row(c))
    h.append('</div>')
    h.append(f'<div class="tk-q__foot"><button class="tk-btn">{ico("hold")}{t("q.held")}<span class="tk-chip tk-chip--brand num">2</span></button><button class="tk-btn">{ico("bag")}{t("q.all")}</button></div></aside>')
    return ''.join(h)


# ------------------------------------------------------------------ menu
def wait_chip(w, off=None):
    if off:
        return chip(off, 'danger' if 'Sold' in off or 'ختم' in off else 'warn')
    if w == 'now':
        return chip(t('m.now'), 'ok', 'check')
    tone = 'warn' if w >= 20 else ''
    return chip(t('m.min', n=num(w)), tone, 'clock')


def tile(k, qty=0, sel=False, off=None, split=False, kb=False, zone=None, wait=None):
    e, u, price, w, (c1, c2) = ITEMS[k]
    w = wait if wait is not None else w
    cls = 'tk-tile' + (' is-sel' if sel else '') + (' tk-tile--off' if off else '') + (' is-kb' if kb else '')
    q = f'<span class="tk-qty num">{qty}</span>' if qty else ''
    sub = ''
    if zone:
        sub = f'<div class="tk-tile__s">{t("m.here", n=num(zone))}</div>'
    body = f'<div class="tk-tile__top"><span class="tk-ph" style="--ph1:{c1}; --ph2:{c2}"></span><div><div class="tk-tile__n">{iname(k)}</div>{sub}</div></div>'
    if split:
        body += f'<div class="tk-split"><button>{t("m.half")}<small class="money" dir="ltr">Rs\u00a0{price:,}</small></button><button>{t("m.full")}<small class="money" dir="ltr">Rs\u00a0{price * 2 - 200:,}</small></button></div>'
        body += f'<div class="tk-tile__b" style="margin-top:0">{wait_chip(w, off)}</div>'
    else:
        body += f'<div class="tk-tile__b"><span class="tk-tile__p" dir="ltr">Rs {price:,}</span>{wait_chip(w, off)}</div>'
    return f'<div class="{cls}" role="button" aria-disabled="{"true" if off else "false"}">{q}{body}</div>'


def cats(sel='top'):
    out = []
    for k, e, u in CATS:
        s = ' is-sel' if k == sel else ''
        out.append(f'<button class="tk-cat{s}">{ico("star", "ico ico--sm") if k == "top" else ""}{u if ur() else e}</button>')
    return '<div class="tk-cats">' + ''.join(out) + '</div>'


def menu(mode='normal', qtys=None, sel=None, search=None, sugg=False, offline=False):
    qtys = qtys or {}
    sfocus = ' is-focus' if search else ''
    stext = f'<span style="color:var(--ink); font-weight:800; font-size:19px" dir="ltr">{search}</span><span style="width:2px;height:26px;background:var(--ink)"></span>' if search else t('m.search')
    h = [f'<section class="tk-mid"><div class="tk-mtop" style="position:relative"><div class="tk-search{sfocus}">{ico("search")}{stext}{kbd("/")}</div>']
    if sugg:
        rows = [('rnaan', True), ('naan', False), ('roti', False)]
        h.append('<div class="tk-sugg">' + ''.join(
            f'<div class="tk-sugg__r{" is-sel" if s else ""}"><span class="tk-ph" style="width:40px;height:40px;--ph1:{ITEMS[k][4][0]};--ph2:{ITEMS[k][4][1]}"></span><b>{num("4×")} {iname(k)}</b><span class="muted" dir="ltr">Rs {ITEMS[k][2] * 4:,}</span>{kbd("Enter") if s else kbd("↓")}</div>'
            for k, s in rows) + f'<div class="tk-hint" style="margin-top:6px">{kbd("4n")} = 4 × naan · {kbd("hk")} = half karahi · {kbd("Enter")} add · {kbd("Esc")} clear</div></div>')
    h.append('</div>')
    h.append(cats('top'))
    if mode == 'rush':
        h.append(f'<div class="tk-pinned">{ico("bolt", "ico ico--sm")}{t("m.pinned")}</div>')
        keys = ['paye', 'ck', 'rnaan', 'naan', 'roti', 'lassi', 'raita', 'tawa', 'mk', 'qeema', 'tikki', 'seekh', 'slassi', 'cold', 'salad', 'maghaz', 'water', 'tikka']
        h.append('<div class="tk-grid tk-grid--rush">')
        for i, k in enumerate(keys[:20]):
            h.append(tile(k, qtys.get(k, 0), split=(k in ('ck', 'mk')), sel=(k == sel), off=(t('m.sold_out') if k == 'tikka' else None)))
        h.append('</div>')
    else:
        keys = ['paye', 'ck', 'rnaan', 'lassi', 'tawa', 'naan', 'raita', 'mk', 'qeema', 'tikki', 'tikka', 'seekh', 'roti', 'maghaz', 'slassi', 'cold']
        h.append('<div class="tk-grid">')
        for k in keys:
            off = t('m.sold_out') if k == 'tikka' else (t('m.paused') if k == 'seekh' and mode == 'paused' else None)
            h.append(tile(k, qtys.get(k, 0), sel=(k == sel), off=off, split=(k in ('ck', 'mk')), zone=(18 if k == 'paye' else None),
                          kb=(search is not None and k == 'rnaan'), wait=('—' if offline else None) if False else None))
        h.append('</div>')
    h.append(f'<div class="tk-hint" style="margin:0 0 14px">{ico("kbd", "ico ico--sm")}{kbd("/")} {t("m.keys")}: {kbd("4n")} {kbd("Enter")} · {kbd("F2")} {t("ctx.new")} · {kbd("F8")} {t("c.send_pay")} · {kbd("F9")} {t("c.send_later")} · {kbd("Esc")} {t("shell.back")}</div>')
    h.append('</section>')
    return ''.join(h)


# ------------------------------------------------------------------ cart
def stepper(n, sm=False):
    return f'<span class="tk-step{" tk-step--sm" if sm else ""}"><button aria-label="less">{ico("minus")}</button><b dir="ltr">{n}</b><button aria-label="more">{ico("plus")}</button></span>'


def line(k, n, eta, price=None, sub=None, sel=False, moved=False, extra=''):
    p = price if price is not None else ITEMS[k][2] * n
    if eta == 'now':
        e = f'<span class="tk-eta tk-eta--now">{ico("check")}{t("m.now")}</span>'
    elif eta == '—':
        e = f'<span class="tk-eta">{ico("clock")}—</span>'
    else:
        e = f'<span class="tk-eta{" tk-eta--moved" if moved else ""}">{ico("clock")}{tm(eta)}</span>'
    s = f'<div class="tk-line__s">{sub}</div>' if sub else ''
    return f'<div class="tk-line{" is-sel" if sel else ""}">{stepper(n, sm=not sel)}<div><div class="tk-line__n">{iname(k) if k in ITEMS else k}</div>{s}</div><div class="tk-line__r">{money(p)}{e}</div>{extra}</div>'


def cust(name=None, phone=None, pick='now', focus=None, match=False, err=False, required=False):
    req = f' · <span class="req">{t("c.required")}</span>' if required else f' · {t("c.optional")}'
    nv = f'<span dir="auto">{nm(name)}</span>' if name else f'<span class="ph">{t("c.name_ph")}</span>'
    pv = f'<span dir="ltr" style="font-variant-numeric:tabular-nums">{phone}</span>' if phone else '<span class="ph" dir="ltr">3xx xxxxxxx</span>'
    nf = ' is-focus' if focus == 'name' else ''
    pf = ' is-focus' if focus == 'phone' else (' is-err' if err else '')
    h = [f'<div class="tk-cust"><div class="tk-cust__r">'
         f'<div class="tk-field"><label>{ico("user", "ico ico--sm")}{t("c.name")}{req}</label><div class="tk-input{nf}">{nv}</div></div>'
         f'<div class="tk-field"><label>{ico("phone", "ico ico--sm")}{t("c.phone")}{req}</label><div class="tk-input{pf}" dir="ltr"><span class="pre">+92</span>{pv}</div></div></div>']
    if err:
        h.append(f'<div class="tk-err">{ico("warn", "ico ico--sm")}{t("c.phone_err")}</div>')
    if match:
        h.append(f'<div class="tk-match">{ico("repeat")}<div class="tk-match__m"><b>{t("c.match")}</b><small>{t("c.match_last")}</small></div><button class="tk-btn tk-btn--primary">{ico("repeat")}{t("c.repeat")}</button></div>')
    opts = [('now', 'c.pick_now'), ('15', 'c.pick_15'), ('30', 'c.pick_30'), ('45', 'c.pick_45'), ('time', 'c.pick_time')]
    bs = []
    for k, key in opts:
        lab = t(key)
        if k == 'time' and pick == 'time':
            lab = tm('2:00 PM')
        bs.append(f'<button class="{"is-sel" if pick == k else ""}">{lab}</button>')
    h.append(f'<div class="row" style="gap:10px"><span class="tk-pick__l">{ico("clock", "ico ico--sm")} {t("c.pickup")}</span><div class="tk-pick" style="flex:1">{"".join(bs)}</div></div></div>')
    return ''.join(h)


def cust_compact(pick='now'):
    opts = [('now', 'c.pick_now'), ('15', 'c.pick_15'), ('30', 'c.pick_30'), ('45', 'c.pick_45'), ('time', 'c.pick_time')]
    bs = ''.join(f'<button class="{"is-sel" if pick == k else ""}">{t(key)}</button>' for k, key in opts)
    return f'<div class="tk-cust" style="padding:10px 16px"><div class="row" style="gap:8px"><button class="tk-btn" style="min-height:52px">{ico("user", "ico ico--sm")}{t("c.who_add")}</button><div class="tk-pick" style="flex:1">{bs}</div></div></div>'


def readyby(kind='ok', time='1:42 PM', sub=None):
    if kind == 'none':
        return f'<div class="tk-readyby tk-readyby--none"><span class="tk-readyby__ic">{ico("clock")}</span><div class="tk-readyby__t"><small>{t("c.ready_by")}</small><b>{sub or t("c.times_none")}</b></div></div>'
    if kind == 'later':
        return f'<div class="tk-readyby tk-readyby--later"><span class="tk-readyby__ic">{ico("phone")}</span><div class="tk-readyby__t"><small>{t("c.ready_later")}</small><b dir="ltr">{time}</b><span class="sub">{sub or ""}</span></div></div>'
    if kind == 'now':
        return f'<div class="tk-readyby"><span class="tk-readyby__ic">{ico("check")}</span><div class="tk-readyby__t"><small>{t("c.ready_by")}</small><b>{t("c.ready_now")}</b></div></div>'
    return f'<div class="tk-readyby"><span class="tk-readyby__ic">{ico("clock")}</span><div class="tk-readyby__t"><small>{t("c.ready_by")} · {t("c.ready_by_sub")}</small><b dir="ltr">{time}</b>' + (f'<span class="sub">{sub}</span>' if sub else '') + '</div></div>'


def foot(total, ready_html, note=None, send='pay', disabled=False, serve=False, add_to=None, schedule=None, offline_pay=False, problems=False):
    h = ['<div class="tk-foot">']
    if serve:
        h.append(f'<div class="tk-serve"><b>{ico("info", "ico ico--sm")} {t("c.serve_q")}</b><div class="tk-pick"><button>{t("c.serve_together", t=tm("1:42 PM"))}</button><button class="is-sel">{t("c.serve_now", t=tm("1:42 PM"))}</button></div></div>')
    h.append(ready_html)
    if note:
        h.append(f'<div class="tk-note tk-note--set">{ico("note")}<span class="tk-note__t" dir="auto">{note}</span><button class="tk-btn" style="min-height:44px">{ico("edit", "ico ico--sm")}{t("c.note_edit")}</button></div>')
    if offline_pay:
        h.append(f'<div class="tk-hint" style="background:var(--warn-tint); color:var(--warn)">{ico("wifioff", "ico ico--sm")}{t("c.queued_pay")}</div>')
    h.append(f'<div class="tk-total"><span>{t("c.total")}</span>{"" if total is None else money(total)}</div>')
    dis = ' aria-disabled="true"' if disabled else ''
    if not note:
        h.append(f'<div class="tk-acts" style="grid-template-columns:1fr 1fr"><button class="tk-btn"{dis}>{ico("note")}{t("c.note_add")}</button><button class="tk-btn"{dis}>{ico("hold")}{t("c.hold")} {kbd("F4")}</button></div>')
    else:
        h.append(f'<div class="tk-acts" style="grid-template-columns:1fr"><button class="tk-btn"{dis}>{ico("hold")}{t("c.hold")} {kbd("F4")}</button></div>')
    if problems:
        h.append(f'<button class="tk-btn tk-btn--xl tk-btn--block tk-btn--primary" aria-disabled="true">{ico("warn")}{t("c.fix_first")}</button>')
    elif add_to:
        h.append(f'<button class="tk-btn tk-btn--xl tk-btn--block tk-btn--primary"{dis}>{ico("plus")}{t("c.add_to")} {num(add_to)} · {money(total)}</button>')
    elif schedule:
        h.append(f'<div class="tk-acts"><button class="tk-btn tk-btn--lg">{t("c.send_later")} {kbd("F9")}</button><button class="tk-btn tk-btn--xl tk-btn--primary">{ico("send", "ico flip")}{t("c.schedule")} {tm(schedule)}</button></div>')
    elif offline_pay:
        h.append(f'<button class="tk-btn tk-btn--xl tk-btn--block tk-btn--primary"{dis}>{ico("send", "ico flip")}{t("c.send_later")} {kbd("F9")}</button>')
    else:
        amt = money(total) if total else ''
        h.append(f'<div class="tk-acts"><button class="tk-btn tk-btn--lg"{dis}>{t("c.send_later")} {kbd("F9")}</button><button class="tk-btn tk-btn--xl tk-btn--primary"{dis}>{ico("cash")}{t("c.send_pay")} {kbd("F8")}</button></div>')
    h.append('</div>')
    return ''.join(h)


def std_lines(sel=None, offline=False, sugg=False, delta=False, n_ck=1):
    o = offline
    ln = [f'<div class="tk-grp">{ico("tray", "ico ico--sm")}{t("c.counter")}<span class="time">{t("m.now")}</span></div>',
          line('paye', 2, '—' if o else 'now'),
          line('raita', 1, '—' if o else 'now'),
          f'<div class="tk-grp">{ico("pot", "ico ico--sm")}{t("c.kitchen")}<span class="time" dir="ltr">{"—" if o else ("2:00 PM" if delta else "1:42 PM")}</span></div>']
    ck_sub = f'{t("m.half")} · less oil' if not ur() else f'{t("m.half")} · کم تیل'
    extra = ''
    if sugg:
        extra = f'<div class="tk-addon-sugg"><button>{ico("plus", "ico ico--sm")}{num(4)} {iname("rnaan")}</button><button>{ico("plus", "ico ico--sm")}{iname("salad")}</button></div>'
    if delta:
        extra += f'<div class="tk-delta">{ico("warn", "ico ico--sm")}{t("c.delta", n=num(18))}</div>'
    ln.append(line('ck', n_ck, '—' if o else ('2:00 PM' if delta else '1:42 PM'), price=1450 * n_ck, sub=ck_sub, sel=(sel == 'ck'), moved=delta, extra=extra))
    if not sugg:
        ln.append(line('rnaan', 4, '—' if o else ('2:00 PM' if delta else '1:42 PM'), sel=(sel == 'rnaan'), extra=(f'<div class="tk-qchips"><button>×2</button><button>×4</button><button>×6</button><button>×8</button></div>' if sel == 'rnaan' else '')))
    ln.append(line('lassi', 2, '—' if o else '1:23 PM'))
    return ''.join(ln)


def cart(mode='normal', **kw):
    """mode: normal | empty | offline | day | phone_match | later | phone_err | add_to | serve | delta | note | sugg | problem"""
    h = ['<aside class="tk-cart">']
    if mode == 'add_to':
        h.append(f'<div class="tk-banner tk-banner--info" style="min-height:56px">{ico("plus")}<span>{t("ctx.adding")} {num(53)} · {nm("Bilal")} <span class="muted">· {t("q.paid")} {money(2730)}</span></span></div>')
    elif mode in ('later',):
        h.append(cust(name='Saima', phone='321 7654321', pick='time', required=True))
    elif mode == 'phone_match':
        h.append(cust(phone='300 1234567', focus='phone', match=True))
    elif mode == 'phone_err':
        h.append(cust(name='Usman', phone='300 12345', focus='phone', err=True))
    elif mode == 'empty':
        h.append(cust())
    elif kw.get('compact'):
        h.append(cust_compact())
    else:
        h.append(cust(name=kw.get('name', 'Usman')))
    total_std = 1300 + 120 + 1450 + 280 + 500
    if mode == 'empty':
        quotes = ''.join(f'<div class="tk-qr" style="min-height:60px"><span class="tk-ph" style="width:44px;height:44px;--ph1:{ITEMS[k][4][0]};--ph2:{ITEMS[k][4][1]}"></span><span class="tk-qr__m"><b>{iname(k)}</b></span>{wait_chip(ITEMS[k][3])}</div>' for k in ['paye', 'ck', 'mk', 'tawa', 'rnaan'])
        h.append(f'<div class="tk-lines" style="padding:16px; display:flex; flex-direction:column; gap:8px"><div class="tk-empty" style="padding:8px 0 4px"><div class="tk-empty__ic">{ico("bag")}</div><b>{t("c.empty_t")}</b></div><div class="tk-sec" style="padding-top:8px">{ico("clock", "ico ico--sm")}{t("c.ask_time")}</div>{quotes}</div>')
        h.append(foot(None, '', disabled=True))
    elif mode == 'add_to':
        ln = f'<div class="tk-grp">{ico("pot", "ico ico--sm")}{t("c.kitchen")}<span class="time" dir="ltr">1:33 PM</span></div>' + line('rnaan', 2, '1:33 PM', sel=True) + line('slassi', 1, '1:23 PM')
        h.append(f'<div class="tk-lines">{ln}</div>')
        h.append(foot(390, readyby('ok', '1:33 PM', sub=f'{t("v.ready_at")} #53: {tm("1:31 PM")} → {tm("1:33 PM")}'), add_to=53))
    elif mode == 'later':
        ln = f'<div class="tk-grp">{ico("pot", "ico ico--sm")}{t("c.kitchen")}<span class="time" dir="ltr">2:00 PM</span></div>' + line('mk', 1, '2:00 PM', price=4600, sub=t('m.full')) + line('naan', 8, '2:00 PM') + line('raita', 2, '2:00 PM') + line('cold', 1, '2:00 PM')
        h.append(f'<div class="tk-lines">{ln}</div>')
        h.append(foot(4600 + 320 + 240 + 280, readyby('later', '2:00 PM', sub=f'Kitchen starts the karahi at ~{tm("1:32 PM")}' if not ur() else f'کڑاہی {tm("1:32 PM")} پر شروع ہوگی'), schedule='2:00 PM'))
    else:
        o = mode == 'offline'
        d = mode == 'day'
        h.append(f'<div class="tk-lines">{std_lines(sel=kw.get("sel"), offline=(o or d), sugg=(mode == "sugg"), delta=(mode == "delta"), n_ck=(2 if mode == "delta" else 1))}</div>')
        tot = total_std + (1450 if mode == 'delta' else 0) - (280 if mode == 'sugg' else 0)
        if o:
            rb = readyby('none')
        elif d:
            rb = readyby('none', sub=t('c.times_day'))
        elif mode == 'delta':
            rb = readyby('ok', '2:00 PM')
        else:
            rb = readyby('ok', '1:42 PM', sub=(f'{iname("paye")} + {iname("raita")}: {t("m.now")}' if mode != 'serve' else None))
        h.append(foot(tot, rb, note=('Extra spicy, separate bag for raita' if not ur() else 'زیادہ مرچ، رائتہ الگ تھیلی میں') if mode == 'note' else None,
                      serve=(mode == 'serve'), offline_pay=o, disabled=d, problems=(mode == 'problem')))
    if kw.get('toast'):
        h.append(kw['toast'])
    if kw.get('overlay'):
        h.append(kw['overlay'])
    h.append('</aside>')
    return ''.join(h)


def sent_toast(tok=57, who='Usman', time='1:42 PM'):
    return f'<div class="tk-toast tk-toast--ok" style="bottom:24px; inset-inline-start:456px; width:760px;"><span class="tk-toast__tok" dir="ltr">{tok}</span><span class="grow">{nm(who)} · {t("t.sent")} {tm(time)}<br><small style="font-weight:600; opacity:.85">{ico("print", "ico ico--sm")} slip printing</small></span><button class="tk-btn">{t("t.print")}</button></div>'
