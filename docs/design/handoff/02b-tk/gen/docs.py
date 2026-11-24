"""Generate MAPPING.md, mapping.json, INDEX.html and the string-key table in CHANGES.md from frames.json + strings.py."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from strings import S

ROOT = os.path.join(os.path.dirname(__file__), '..')
frames = json.load(open(os.path.join(ROOT, 'frames.json')))

SCREENS = {
    'TK-SH01': ('Shell — proposed: top bar, context slot, screen tabs, Live/Offline/Rush pill, badges, day / shift banners', 'shell · K T P',
                '`.tk-top` `.tk-ctx` `.tk-tabs` `.tk-tab.is-sel` `.tk-live(--off|--rush)` `.tk-ibtn` `.tk-me` `.tk-banner`',
                'catch-up `business_day`, `GET /queries/shift`, alerts store (Requests / Inbox counts), live socket state, device profile `screens` (05a)'),
    'TK-SH02': ('Person chip menu', 'popover · K T', '`.tk-pop` `.tk-mi`', 'session; `POST /auth/logout`; 05a switch-user flow; `GET /queries/shift`'),
    'TK-SH03': ('Day not started (before the first item)', 'banner · K T P', '`.tk-banner--warn`, cart disabled, `.tk-readyby--none`', 'catch-up business day; `BusinessDayOpened` frame; Start day → `/admin/stock/` (02b Q-20)'),
    'TK-S01': ('Takeaway home = queue + menu + cart (order first)', 'screen · K T P',
               '`.tk-q` (queue rail) `.tk-mid` (menu) `.tk-cart` · `.tk-tile` `.tk-split` `.tk-grid(--rush)` `.tk-line` `.tk-step` `.tk-qchips` `.tk-readyby` `.tk-foot` `.tk-acts`',
               '`GET /queries/open-orders` (+ GAPS G-1 fields), `GET /queries/eta-preview` (250 ms debounce), `GET /queries/stations-live`, `zone-stock`, branch-config, stock mirror; drafts (IndexedDB); `SubmitOrder` (queueable)'),
    'TK-S02': ('Order building helpers: keyboard mode, time delta, companions, note, serve question', 'cart / menu · K T P',
               '`.tk-sugg` `.tk-hint` `.tk-delta` `.tk-addon-sugg` `.tk-note--set` `.tk-serve`',
               '`eta-preview` (previous vs new reply → delta), `stations-live` (station full), companions (GAPS G-5), `SubmitOrder.order_note`, `serve_mode`'),
    'TK-S03': ('Token view (drawer / phone screen) + Add items + queue drawer', 'drawer · K T P',
               '`.tk-drawer` `.tk-tv__tok` `.tk-facts` `.tk-fact(--due|--paid)` `.tk-il` `.tk-banner--info` (adding)',
               '`GET /queries/order-view`, `GET /queries/bill?order_id`, `order-contact` (Call), `MarkServed` (hand over / give ready items), `SubmitOrder{adds_to_order_id}` (Add items), `BoostOrder`, `PrintBillDocument`'),
    'TK-S04': ('Held on this counter', 'drawer · K T P', '`.tk-drawer` `.tk-il`', 'device drafts (IndexedDB), all people of this device (GAPS G-6)'),
    'TK-S05': ('Pickup board (TV)', 'screen · TV 1920×1080', '`.bd-*`', '`GET /queries/pickup-board` + live audience `display` (GAPS G-8), voice clips (G-9)'),
    'TK-S06': ('Packer / Pass — takeaway filter', 'screen · T', '`.pk` `.pk--next` `.pk--ready`', '03b `GET /queries/pass`, `MarkReadyToServe` (Bag ready), `Handover`; bill state (GAPS G-7)'),
    'TK-S07': ('Customer status page (slip QR)', 'web page · customer phone', '`.cs-*`', 'public LAN route `/t/<id>.<sig>` (GAPS G-10)'),
    'TK-S08': ('Counter-facing customer display', 'second monitor · 1920×1080', '`.cd-*`', 'client-only mirror of the cart (BroadcastChannel), Raast QR state (GAPS G-12, G-14)'),
    'TK-D01': ('Customer: name / phone (+92 mask, keypad), match + Repeat', 'inline in cart · K T P', '`.tk-cust` `.tk-field` `.tk-input(.is-focus|.is-err)` `.tk-match` `.tk-keypad`', '`SubmitOrder.takeaway{customer_name, phone}`; `GET /queries/customer-orders?phone` (GAPS G-4)'),
    'TK-D02': ('Pickup time (Now / +15 / +30 / +45 / Time…)', 'inline in cart · K T P', '`.tk-pick` `.tk-readyby--later`', '`SubmitOrder.pickup_at_ms` + eta-preview draft (GAPS G-2)'),
    'TK-D03': ('Item sheet (size, add-ons with steppers, cooking choices, kg, note)', 'sheet · K T P', '`.tk-sheet` `.tk-vars` `.tk-var` `.tk-opts` `.tk-opt(--off)` `.tk-step--sm` `.tk-keypad`', 'branch-config items / modifier groups (`max_choices`, option `max_quantity`), availability; `Option.quantity` already in `SubmitOrder`'),
    'TK-D04': ('Deal sheet', 'sheet · K T P', 'as TK-D03 + `.tk-il`', 'branch-config deals'),
    'TK-D05': ('Send without a dialog (toast) / queued', 'toast · K T P', '`.tk-toast(--ok)` `.tk-toast__tok`', '`SubmitOrder` result `token`, `groups[].promise_ms`; queue (25b)'),
    'TK-D06': ('Pay panel: cash notes / card ref / NFC / Raast QR / paid / error', 'panel over cart · K T P', '`.tk-paypanel` `.tk-modes` `.tk-notes` `.tk-tendered` `.tk-change(--short)` `.tk-qrbox` `.tk-nfc`', '`GET /queries/bill?order_id`, `AddPayment`, `CloseSplit` (receipt), payment modes; NFC / Raast (GAPS G-12)'),
    'TK-D07': ('Remove / cancel from a token', 'dialog · K T P', '`.tk-dlg` `.tk-il` `.tk-step--sm`', '`RemoveItems` (not started), `VoidItems` (04, approval), bill refund through 05 reopen rules'),
    'TK-D08': ('Leave guard', 'dialog · K T P', '`.tk-dlg`', 'drafts (Hold = `held: true`)'),
    'TK-C01': ('Menu tile — states', 'component', '`.tk-tile` and modifiers', 'availability, stock mirror, stations-live'),
    'TK-C02': ('Ready tile + queue row — states, hand-over undo', 'component', '`.tk-rt(--due|--late|--part)` `.tk-qr(--q)` `.tk-tok`', 'open-orders (G-1), `MarkServed` delayed 5 s for Undo (client)'),
    'TK-P01': ('Token slip (80 mm)', 'print', '`.slip`', '03c slip doc (GAPS G-11)'),
    'TK-HR': ('Hostile review — before / after', 'review', '—', '—'),
}

order = list(SCREENS.keys())
by = {}
for f in frames:
    by.setdefault(f['screen'], []).append(f)

dev = {'kiosk': 'kiosk 1920×1080', 'tablet': 'tablet 1280×800', 'phone': 'phone 390×844', 'tv': 'TV 1920×1080', 'component': 'component sheet', 'slip': '80 mm slip', 'display': 'customer display 1920×1080'}

md = ['# Module 02b-TK · Takeaway — mapping', '',
      f'Every takeaway screen → its frames (one per state) → components (`design/pulse-tk.css`) → the data it reads / writes. {len(frames)} frames, all new. Endpoints that do not exist yet are marked with their GAPS id.', '',
      '| Screen | Name | Kind · devices | Frames (state · device) | Components | Data (reads / writes) |', '|---|---|---|---|---|---|']
mj = []
for sid in order:
    name, kind, comps, data = SCREENS[sid]
    fl = by.get(sid, [])
    cell = '<br>'.join(f"`{f['stem']}.dc.html` — {f['title']} ({f['state']} · {dev[f['device']]}{' · Urdu' if f['lang'] == 'ur' else ''})" for f in fl)
    md.append(f'| **{sid}** | {name} | {kind} | {cell} | {comps} | {data} |')
    mj.append(dict(screen=sid, name=name, kind=kind, components=comps, data=data, frames=[dict(file=f"design/{f['stem']}.dc.html", png=f"design/screens/{f['stem']}.png", state=f['state'], device=f['device'], lang=f['lang'], title=f['title']) for f in fl]))

md += ['', '## State coverage (screen × state)', '', '| Screen | empty | normal | RUSH | offline | error | Urdu |', '|---|---|---|---|---|---|---|']
cov = {
    'TK-S01 Takeaway home': ['HomeEmpty', 'HomeKiosk · HomeTablet · PhoneMenu/Cart', 'HomeRush · HomeRushUrdu · QueueTablet', 'HomeOffline · PhoneOffline · SentQueued', 'HomeError · DayNotStarted', 'HomeUrdu · HomeTabletUrdu · PhoneCartUrdu'],
    'TK-S03 Token view': ['—(a token always has lines)', 'TokenDue · TokenReady · TokenPartial · TokenLate · PhoneToken', 'QueueTablet', 'pattern: HomeOffline (actions that need the hub greyed, Hand over queues as MarkServed)', 'TokenRemove (void needs approval)', 'TokenUrdu'],
    'TK-D06 Pay': ['—', 'PayCash · PayCard · PayRaast · PayNfcTablet · PayDone', 'same panel', 'HostileReview #4 (Send only, Due)', 'PayCashShort · PayError', 'PayUrdu'],
    'TK-D01/D02 Customer + pickup': ['HomeEmpty', 'PhoneRepeat · PickupLater', '—', 'phone field works offline; match needs hub (hidden)', 'PhoneInvalid', 'PickupLaterUrdu'],
    'TK-D03/D04 Item & deal sheets': ['—', 'ItemSheet · ItemSheetKg · DealSheet', 'rush tile skips the sheet (TileStates)', 'same (menu is local)', 'off option + sold-out choice in ItemSheet', 'ItemSheetUrdu'],
    'TK-S05 Board': ['BoardEmpty', 'Board · BoardCall', 'BoardRush', 'BoardOffline', 'BoardOffline (never shows a wrong Ready)', 'bilingual on every frame'],
    'TK-S07 Status page': ['—', 'StatusCooking · StatusReady', '—', 'page says “updating…” (pattern of BoardOffline)', '—', 'StatusUrdu'],
}
for k, v in cov.items():
    md.append(f'| {k} | ' + ' | '.join(v) + ' |')

open(os.path.join(ROOT, 'MAPPING.md'), 'w').write('\n'.join(md) + '\n')
json.dump(mj, open(os.path.join(ROOT, 'mapping.json'), 'w'), indent=1, ensure_ascii=False)

# INDEX.html
cards = ''.join(f'<a class="c" href="design/{f["stem"]}.dc.html"><img src="design/screens/{f["stem"]}.png" loading="lazy"><b>{f["stem"]}</b><span>{f["screen"]} · {f["state"]} · {dev[f["device"]]}</span><small>{f["title"]}</small></a>' for f in frames)
open(os.path.join(ROOT, 'INDEX.html'), 'w').write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>02b-TK Takeaway — {len(frames)} frames</title>
<style>body{{margin:0;font:15px/1.4 system-ui,sans-serif;background:#F8F1E7;color:#2B130E}}h1{{margin:0;padding:24px 28px;background:#6E140E;color:#FFF3E6;font-size:24px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px;padding:24px}}.c{{display:flex;flex-direction:column;gap:4px;background:#fff;border-radius:14px;padding:10px;text-decoration:none;color:inherit;box-shadow:0 2px 10px rgb(0 0 0/.06)}}
.c img{{width:100%;aspect-ratio:16/10;object-fit:contain;background:#eee;border-radius:8px}}.c span{{color:#6E5549;font-size:13px}}.c small{{color:#2B130E}}</style></head>
<body><h1>Module 02b-TK · Takeaway — {len(frames)} frames (Pulse)</h1><div class="g">{cards}</div></body></html>''')

# strings table
rows = ['| Key | English | Urdu |', '|---|---|---|'] + [f'| `{k}` | {en} | {u} |' for k, (en, u) in S.items()]
open(os.path.join(ROOT, 'strings-table.md'), 'w').write('\n'.join(rows) + '\n')
print(len(frames), 'frames;', len(S), 'strings')
