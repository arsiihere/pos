A restaurant POS that runs on a box in the back room and is used by people in a hurry: cashiers at a kiosk, waiters on cheap phones, cooks reading a wall screen with greasy hands. Every rule below serves one test: **can a tired person read it from where they stand and tap it without looking twice?**

Load `tokens.css` and `components/bundle.css`, wrap the page in `.pos-root`, and set `lang` and `dir` on `<html>` (`en`/`ltr` or `ur`/`rtl`). Set `data-theme="dark"` on KDS and on the pair screen; everything else is `light`.

## Content

- **Plain words, verb first, sentence case.** "Approve", "Pair again", "Ask a manager to pair this screen". No jargon: "screen", not "device"; "hub", not "server"; "kitchen screen", not "KDS" in anything staff read.
- **Say what to do next, not what went wrong.** `PAIRING_REQUEST_NOT_FOUND` reads "No screen is waiting with this code. Check the code on the screen." Never show an error code or the server's message.
- **Numbers are exact and short:** "2 tries left", "Locked · 14 min", "Expires in 9:41". Round lockout minutes up.
- **You, not we.** Address the person in front of the screen; the system has no voice of its own. No exclamation marks, no emoji.
- **Every string is a key** (`pairing.hub_unreachable`, `errors.<CODE>`) with English and Urdu text. Urdu is written natural, not word-for-word.

## Language and direction

- English ships first; every screen is designed and checked in **Urdu, mirrored RTL** too. Use logical CSS properties only (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`); the components already do.
- **Never mirrors** (wrap in `.pos-ltr` or use a mono style): display codes, PINs and the PIN pad, phone numbers, prices and quantities, IP addresses, CIDRs, QR codes, times.
- Set Urdu in `ur-display`, `ur-title` and `ur-body` (Noto Nastaliq Urdu). Nastaliq needs about **2× line height** and runs wider than Latin: no fixed heights on anything that holds text, and Urdu body is one step larger (20px) than Latin body.
- Digits in Urdu mode: Latin (123) until the owner decides; keep both possible by never baking digits into images.

## Colour

- Two themes. **Light (floor)**: `ink` on `surface`, cards on `surface-raised`. **Dark (kitchen)**: same token names, for KDS and the pair screen, where glare and distance matter.
- One `action` (near-black in light, near-white in dark) for the one primary button per screen. No coloured primary buttons.
- `accent` (saffron) is identity and selection only: the selected tile, filled PIN dots, the display-code underline, the focus ring in dark. It never means a status and never fills a button.
- Status is `ok` (blue), `warn` (ochre), `danger` (vermilion), `info` (slate), each with a `*-tint` ground, **always with an icon and a word**. `ok` is blue, not green, so it never relies on red–green vision against `danger`.
- Every text pair meets 4.5:1 in both themes (`ink-faint` is large text and icons only, 3:1). The focus ring is 3px solid `focus` with a 3px offset so it always lands on a surface.
- QR codes are black on a `qr-tile` (white) tile in both themes.

## Type

- **Atkinson Hyperlegible** (sans) for all Latin text: built for low vision, its letters don't confuse (I/l/1, O/0). **Atkinson Hyperlegible Mono** for codes, PINs and addresses. **Noto Nastaliq Urdu** for Urdu. All OFL, all bundled in `fonts/` (≈370 KB total); nothing loads from the internet.
- Defaults: `body-lg` (20px) on kiosk, tablet and KDS; `body` (17px) on phones. Nothing a cook or cashier must read is below 17px. `caption` (15px, `ink-muted`) is for metadata only, never on KDS.
- `display` for the one headline of a full-screen state; `code-display` (72px) for the pairing code, readable at 3 m.

## Space, size and shape

- Tap targets: `touch-min` (56px) everywhere, `touch-kitchen` (72px) on KDS and the pair screen. At least `space-3` between targets.
- Gutters: `space-4` on phones (design down to 360px wide), `space-6` on tablet/kiosk, `space-12` around full-screen states. Forms are one column, `content-max` wide.
- Radii: `radius-sm` inputs, `radius-md` buttons, keys and tiles, `radius-lg` cards, dialogs and the QR tile.
- Elevation: light uses `shadow-raise`; dark uses a 1px `line` edge instead of shadows.

## Interaction

- **No hover, no double-tap, no long-press-only and no swipe-only actions.** Everything works by one tap, and by keyboard on the kiosk.
- Busy states keep the button where it is and add `is-busy`; a slow call (setup can take 10 s) also shows a warn Banner after 3 s.
- Losing the hub is normal (power cuts): show a calm reconnecting Banner, keep what's on screen, retry quietly (backoff to 5 s). Never a blank page.
- The kiosk has no browser back: every full-screen state has its own way forward.
- Motion is limited to the spinner, the reconnect icon and one PIN-pad shake, and stops under `prefers-reduced-motion`.

## The hub is offline

Pages are served over plain HTTP on the restaurant LAN, often with no internet. So: no Google Fonts, CDNs, icon fonts or remote images; no in-page camera (phones scan QR codes with the OS camera), no clipboard buttons, no notifications. Fonts, icons and CSS ship inside the hub and the Android app.

## Iconography

Inline SVG only, `class="pos-icon"` (24px) or `pos-icon--lg` (40px): 24px grid, 2px round stroke, no fill, `currentColor`. Always next to a word. `back` mirrors in RTL (`pos-icon--flip`); nothing else does.

| Name | Source |
| --- | --- |
| `check` | `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` |
| `alert` | `<svg viewBox="0 0 24 24"><path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/></svg>` |
| `clock` | `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>` |
| `sync` | `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/></svg>` |
| `lock` | `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>` |
| `wifi` | `<svg viewBox="0 0 24 24"><path d="M2.5 8.5a14 14 0 0 1 19 0"/><path d="M5.5 12a9.5 9.5 0 0 1 13 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19v.01"/></svg>` |
| `screen` | `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/></svg>` |
| `phone` | `<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>` |
| `flame` | `<svg viewBox="0 0 24 24"><path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 2.8-5.6 4-8.8 2.2 1.4 2.8 3.6 2.6 5.4 1.2-.4 2-1.6 2.2-3 2 1.8 2.2 4.2 2.2 6.4C16.5 18.4 15 21 12 21z"/></svg>` |
| `back` | `<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>` |
| `share` | `<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v8.5h12V11"/></svg>` |
| `add-home` | `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7"/><path d="M8.5 12h7"/></svg>` |
| `user` | `<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>` |
| `x` | `<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>` |
| `unlock` | `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/></svg>` |
| `tablet` | `<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/></svg>` |
| `plus` | `<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>` |
| `grid` | `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>` |
| `box` | `<svg viewBox="0 0 24 24"><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5"/><path d="M12 12v9"/></svg>` |
| `printer` | `<svg viewBox="0 0 24 24"><path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6.5H7z"/></svg>` |
| `gauge` | `<svg viewBox="0 0 24 24"><path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/></svg>` |
| `qr` | `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2z"/><path d="M18 18h2v2h-2z"/><path d="M14 18h2"/><path d="M18 14h2"/></svg>` |
| `logout` | `<svg viewBox="0 0 24 24"><path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/></svg>` |
| `search` | `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>` |
| `reload` | `<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>` |
| `download` | `<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>` |
| `link` | `<svg viewBox="0 0 24 24"><path d="M10 14l4-4"/><path d="M8.5 11.5L6 14a3 3 0 0 0 4 4l2.5-2.5"/><path d="M15.5 12.5L18 10a3 3 0 0 0-4-4l-2.5 2.5"/></svg>` |
