# 05a — Urdu to do

No design hand-off exists for 05a (plan PL-1: existing page patterns). Every `devices.*` key in `apps/client/src/i18n/en.ts` has no Urdu yet; it shows in English on an Urdu page (01a S49 fallback). `apps/client/src/features/devices/strings.test.ts` checks that each is in `ur.ts` or listed here. Whoever merges second keeps both lanes' rows.

| Key | English |
|---|---|
| `devices.title` | Devices |
| `devices.group.waiting` | Waiting |
| `devices.group.kitchen` | Kitchen |
| `devices.group.personal` | Personal |
| `devices.group.counter` | Counter |
| `devices.group.floor` | Floor |
| `devices.group.pass` | Pass |
| `devices.group.back_office` | Back office |
| `devices.needs_review` | needs review |
| `devices.warn.none` | No device can manage devices |
| `devices.warn.one` | Only one device can manage devices — add a backup |
| `devices.hw.tablet` | Tablet |
| `devices.hw.cashier_kiosk` | Cashier kiosk |
| `devices.hw.kds` | Kitchen screen |
| `devices.hw.phone` | Phone |
| `devices.hw.unknown` | Device |
| `devices.screen.dine_in` | Dine-in |
| `devices.screen.takeaway` | Takeaway |
| `devices.screen.parking` | Parking |
| `devices.screen.cashier` | Cashier |
| `devices.screen.pass` | Pass |
| `devices.screen.manager` | Manager |
| `devices.everyone` | Everyone |
| `devices.approve` | Approve |
| `devices.edit` | Edit |
| `devices.reload` | Reload |
| `devices.empty` | No devices yet |
| `devices.load_failed` | Couldn't load the devices. |
