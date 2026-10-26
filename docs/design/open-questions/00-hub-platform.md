# 00 — Hub Platform & Access: open questions

Copy to `docs/design/open-questions/00-hub-platform.md`.

How to use this file: each question has a **recommended answer**. Claude Code builds with the recommended answer unless the status says otherwise. To change one, edit its **Decision** line and set **Status** to `answered`. Then ask Claude Code to "apply decisions in docs/design/open-questions/00-hub-platform.md".

Status values: `recommended` (default in use, owner has not confirmed) · `answered` (owner decided) · `blocked` (needs owner before build).

---

## Q1 Who owns the hub admin home and side menu?
- **Context:** No spec has a hub admin home or navigation. Without one, a manager cannot reach devices, sessions, lockouts, stock, capacity, printers or backups.
- **Recommended:** Module 00 owns it. Route `/admin` serves 00-S20, using the same admin sign-in as `/admin/approve`. The side menu is a shared shell: each later module (01a stock, 03a capacity, 03b printers, 06 backup) adds one menu item. Menu items hide by permission.
- **Why:** 00 already owns admin sessions and permissions. Giving the shell to 01b would split auth from the pages that use it.
- **Decision:** Module 00 owns `/admin` (recommended)
- **Status:** recommended

## Q2 What does `/setup` show after the hub is set up?
- **Recommended:** Keep HTTP status 404, but return the styled "This hub is already set up" page (frame `SetupAlready`) instead of a plain 404. It reveals nothing sensitive, and it saves an installer from calling support.
- **Decision:** styled page with status 404 (recommended)
- **Status:** recommended

## Q3 Should screen and IP lockouts get a list query?
- **Recommended:** Yes. Add `GET /admin/queries/lockouts` returning `{ staff: [{staff_id, display_name, locked_until}], devices: [{device_id, device_name, locked_until}], ips: [{ip, locked_until, source:'bootstrap'|'pair'}] }`. It needs `access-hub-admin`.
- **Why:** Clearing a lockout you cannot see is useless. A cashier screen locked during the rush (`DEVICE_LOCKED_OUT`) is a real case at 1 500–2 000 orders a day.
- **Until it exists:** ship the People section only, read from `locked_until` in the roster.
- **Decision:** add the query (recommended)
- **Status:** recommended

## Q4 Should the owner app have "Add a hub / Replace a hub"?
- **Recommended:** Not for the pilot. With 3 branches, a support CLI (`issue-registration-code`) is enough. Add it in module 06, next to replace-hub, before selling to other restaurants.
- **Decision:** defer to 06 (recommended)
- **Status:** recommended

## Q5 How are waiter tablets paired?
- **Context:** Approve (00-S08) offers only Cashier screen or Kitchen screen. Phones are personal: one owner, so only that person can sign in. The devices list already has a "Tablets" group.
- **Recommended:** Treat waiter tablets as **shared screens**:
  - They are paired by screen code like a kiosk.
  - They get a third type, `waiter_tablet`, on 00-S08: "Waiter tablet".
  - The roster shows all floor staff.
  - The idle logout is 5 min, the same as staff sessions.
- **Spec change needed:**
  - `device_type` enum gains `waiter_tablet`.
  - `ApprovePairingRequest` accepts it, with no station.
  - 02 login reads the roster for it.
- **Design change:** 00-S08 gets three segment options (Cashier screen / Waiter tablet / Kitchen screen). This is small; Claude Code can add it.
- **Decision:** `waiter_tablet` shared type (recommended)
- **Status:** blocked. The spec enum change must be approved before build. Until then, build 00-S08 with two options.

## Q6 Where does the staff Wi-Fi name come from?
- **Recommended:**
  - Add an optional `staff_wifi_name` to branch config (owner app, 01b branch settings).
  - The hub includes it in `GUEST_NETWORK_FORBIDDEN` `details.staff_wifi_name`.
  - If it is empty, show the sentence without the name (`global.wifi_body_unknown`).
- **Decision:** optional config field (recommended)
- **Status:** recommended. The UI fallback works without it, so build the fallback now.

## Q7 Should the setup page offer the hub's addresses as a pick-list?
- **Recommended:** Yes, and it needs no API change. `/setup` is rendered by the hub itself, so the page can list `os.networkInterfaces()`:
  - Show IPv4 only, not internal, with link-local `169.254.*` removed.
  - Show them as radio tiles: "192.168.0.107 · Ethernet" and "192.168.1.34 · Wi-Fi".
  - Add "Other address" with the typed field as the fallback.
  - Preselect Ethernet when one exists.
- **Why:** This prevents the two-network mistake (inventory edge case) and saves typing.
- **Design delta:** 00-S01 field 2 becomes a `.pos-tiles--pick` group plus an "Other" text field. Same tokens, no new class.
- **Decision:** pick-list + typed fallback (recommended)
- **Status:** recommended

## Q8 When does a kitchen screen show "Not seen"?
- **Recommended:**
  - Warn when `last_seen_at` is older than **2 minutes**, at any time of day.
  - The KDS heartbeat must update `last_seen_at` at least every 30 s.
  - Show the same warning on the hub admin home tile.
- **Why:** 2 min is long enough to ignore a Wi-Fi blip and short enough to catch a dead tandoor screen before tickets pile up (they fall back to auto-print in 03b).
- **Decision:** 2 min (recommended)
- **Status:** recommended

## Q9 Should the devices list show why a device was removed?
- **Recommended:** Yes. `GET /admin/queries/devices` returns `revoked_reason` and `revoked_by_name` with `revoked_at`. It is already stored for the audit log.
- **Decision:** return reason and by (recommended)
- **Status:** recommended

## Q10 What does a kitchen screen show after a manager ends its session?
- **Recommended:** The screen stays paired and shows a dark full-screen state:
  - Title: "Kitchen screen stopped by Imran". Body: "Tickets for Tandoor print until you start it again."
  - One 72 px primary button **Start kitchen screen**, which starts a new station session.
  - It does **not** go back to pairing.
- **Owner:** 03b owns that frame; 00 only ends the session.
- **Decision:** stopped state with Start button, owned by 03b (recommended)
- **Status:** recommended. Design it with module 03b.

## Q11 Should phone pages be light while `/pair` is served dark?
- **Context:** Spec M82 serves `/pair` with `data-theme="dark"` (screens). The phone frames (Phone*) are light. The build keeps the served attribute and switches to light in the page script when `?t=` is present.
- **Recommended:** Keep it, and add one line to spec §8.2: "phones (`/pair?t=`) use the light theme".
- **Decision:** light for phones (recommended)
- **Status:** recommended

## Q12 Should the API return names the designs show?
- **Context:** Three designed texts have no data: the role under each roster tile ("Owner", "Manager"), the station on a screen's "Paired" ("Opening the Tandoor kitchen screen…"), and the owner on "This phone is paired" ("Only Bilal's name will be on it"). Today they are left out or generic.
- **Recommended:** Add `role_names` to `GET /admin/login-roster`, `station_name` to the approved `GET /pair/requests/:id`, and `owner_name` to `POST /devices/pair`. Spec change (additive fields), small.
- **Decision:** add the three fields (recommended)
- **Status:** recommended. Not built: it changes three response contracts.

## Q13 Should `HOST_NOT_ALLOWED` say which address to use?
- **Context:** 00-F07 shows the hub's address when the error carries it. The hub sends no details today, so the installer only reads "Type the number address in the browser".
- **Recommended:** Add `details.advertised_host` to `HOST_NOT_ALLOWED` once the hub is provisioned (it is not secret on the LAN). Spec change.
- **Decision:** add the address (recommended)
- **Status:** recommended. Not built.

## Q14 Who translates and reviews the Urdu?
- **Context:** `docs/design/handoff/00/urdu-todo.md` lists 240 keys with English only; the Urdu that exists comes from the frames and has not been reviewed. Untranslated English inside an Urdu page can show digits out of order (right-to-left ordering).
- **Recommended:** A native speaker translates the list and reviews the existing Urdu before the pilot; the designer adds Urdu frames for the hub admin pages.
- **Decision:** translate + review before the pilot (recommended)
- **Status:** recommended

---

## Smaller items found while designing (no decision needed, FYI)
- **List chip colours:** `.pos-list__name span` was changed to `.pos-list__name > span`, because chips inside list rows were losing their colour. This also fixes the 01a Stock chips.
- **Urdu copy:** Urdu text exists only in the Urdu frames (one per surface). A native reviewer should check it before release, and any key without an Urdu frame needs translating.
- **Digits:** digits stay Latin in Urdu until the owner decides (design system rule).
