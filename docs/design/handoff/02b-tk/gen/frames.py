"""All 02b-TK frames. Each entry: id, file stem, title, screen id, device, state, builder."""
import core
from core import *  # noqa

FRAMES = []


def frame(stem, screen, device, state, title, lang='en'):
    def deco(fn):
        FRAMES.append(dict(stem=stem, screen=screen, device=device, state=state, title=title, lang=lang, fn=fn))
        return fn
    return deco


def kiosk(top_html, q_html, mid_html, cart_html, banner='', overlay=''):
    return f'{top_html}{banner}<div class="tk-body">{q_html}{mid_html}{cart_html}</div>{overlay}'


QTY = {'paye': 2, 'raita': 1, 'ck': 1, 'rnaan': 4, 'lassi': 2}

# ====================================================================== SHELL (proposed)


@frame('ShellAnatomy', 'TK-SH01', 'component', 'normal', 'Shell — proposed: top bar parts, tab active state, offline, rush, day/shift banners')
def _():
    rows = [
        ('Normal · Takeaway home', top(ctx=ctx_new())),
        ('Order screen with Back + context slot', top(ctx=('bag', 'Token 53 · Bilal', 'Paid · ready by 1:31 PM'), back=True)),
        ('Hub offline', top(ctx=ctx_new(), live='off', req=0)),
        ('Rush mode (40 open)', top(ctx=ctx_new(), rush_n=40, tab_counts={'parking': 3})),
    ]
    h = ['<div class="cmp col" style="gap:28px; padding:40px; flex:1">',
         '<h1>Shell — proposed (only what takeaway needs)</h1>',
         '<p class="muted" style="font-size:18px; margin:0">One selected style everywhere: cream fill + saffron underline (<b>.is-sel</b>). Tabs come from the device profile (05a). The person chip opens a menu — it never signs out on one tap.</p>']
    for lbl, html in rows:
        h.append(f'<div class="col" style="gap:8px"><h3>{lbl}</h3><div style="border-radius:16px; overflow:hidden; box-shadow:var(--shadow-raise)">{html}</div></div>')
    h.append(f'<div class="col" style="gap:8px"><h3>Day / shift banners (under the top bar, before the first item)</h3>'
             f'<div class="tk-banner tk-banner--warn" style="border-radius:12px">{ico("warn")}{t("shell.day.closed")}<button class="tk-btn tk-btn--primary">{t("shell.day.start")}</button></div>'
             f'<div class="tk-banner tk-banner--warn" style="border-radius:12px">{ico("cash")}{t("shell.shift.closed")}<button class="tk-btn tk-btn--primary">{t("shell.shift.open")}</button></div>'
             f'<div class="tk-banner tk-banner--danger" style="border-radius:12px">{ico("wifioff")}Hub offline since 1:18 PM — orders are queued and sent when it is back. Payments wait.</div></div>')
    h.append('</div>')
    return page('Shell anatomy', ''.join(h), 'sheet', 'cmp')


@frame('PersonMenu', 'TK-SH02', 'kiosk', 'normal', 'Person chip menu — Switch user · Lock · My shift · Sign out (never one-tap sign out)')
def _():
    return page('Person menu', kiosk(top(ctx=ctx_new('Usman'), menu=True), queue(), menu(qtys=QTY), cart()) + me_menu(), 'kiosk')


@frame('DayNotStarted', 'TK-SH03', 'kiosk', 'error', 'Day not started — blocked before the first item, times explain why')
def _():
    b = f'<div class="tk-banner tk-banner--warn">{ico("warn")}{t("shell.day.closed")}<span class="muted">· Lake City · 7:04 AM</span><button class="tk-btn tk-btn--primary">{t("shell.day.start")}</button></div>'
    return page('Day not started', kiosk(top(ctx=ctx_new(), clock='7:04 AM', req=0, inbox=0), queue('empty'), menu(), cart('day'), banner=b), 'kiosk')


# ====================================================================== TAKEAWAY HOME (= order screen, order first)


@frame('HomeKiosk', 'TK-S01', 'kiosk', 'normal', 'Takeaway home — queue · menu · cart in one screen; live “Ready by 1:42 PM”; Send & pay')
def _():
    return page('Takeaway home', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()), 'kiosk')


@frame('HomeEmpty', 'TK-S01', 'kiosk', 'empty', 'Start of lunch — no orders, empty cart answers “kitna time?” from live station waits')
def _():
    return page('Takeaway home empty', kiosk(top(ctx=ctx_new(), clock='12:31 PM', req=0, inbox=0), queue('empty'), menu(), cart('empty')), 'kiosk')


@frame('HomeRush', 'TK-S01', 'kiosk', 'rush', 'RUSH — 40 open: rush mode (dense 5-col tiles, half/full on the tile, top items pinned, compact queue)')
def _():
    return page('Takeaway rush', kiosk(top(ctx=ctx_new(name='Usman'), rush_n=40, clock='1:34 PM', req=2, inbox=5), queue('rush'), menu('rush', qtys=QTY, sel='rnaan'), cart(sel='rnaan', compact=True)), 'kiosk')


@frame('HomeOffline', 'TK-S01', 'kiosk', 'offline', 'Hub offline — orders queue (token after sending), times “—”, payment waits; queue frozen “as of”')
def _():
    b = f'<div class="tk-banner tk-banner--danger">{ico("wifioff")}Hub offline since 1:18 PM — orders are kept and sent when it is back. 1 waiting to send.</div>'
    return page('Takeaway offline', kiosk(top(ctx=ctx_new(name='Usman'), live='off', req=0), queue('offline', queued_row=True), menu(qtys=QTY), cart('offline'), banner=b), 'kiosk')


@frame('HomeError', 'TK-S01', 'kiosk', 'error', 'Errors — queue read failed (retry), a cart line problem blocks Send (“Fix 1 item first”)')
def _():
    t_ = f'<div class="tk-toast" style="bottom:24px; inset-inline-start:50%; transform:translateX(-50%)">{ico("warn")}{t("t.sold_out")}</div>'
    return page('Takeaway error', kiosk(top(ctx=ctx_new(name='Usman')), queue('error'), menu(qtys=QTY), cart('problem')) + t_, 'kiosk')


@frame('HomeUrdu', 'TK-S01', 'kiosk', 'urdu', 'Urdu RTL — mirrored layout; tokens, money, times, phones stay LTR', 'ur')
def _():
    return page('ٹیک اوے', kiosk(top(ctx=ctx_new(name='Usman')), queue(), menu(qtys=QTY), cart()), 'kiosk')


@frame('HomeRushUrdu', 'TK-S01', 'kiosk', 'rush · urdu', 'Rush mode in Urdu', 'ur')
def _():
    return page('رش', kiosk(top(ctx=ctx_new(name='Usman'), rush_n=40, clock='1:34 PM', req=2, inbox=5), queue('rush'), menu('rush', qtys=QTY), cart(compact=True)), 'kiosk')
