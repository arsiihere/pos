# Urdu still to translate (module 00)

These keys in `apps/hub/src/lib/strings.ts` have English only; the pages show the English text in Urdu mode until `UR` has them (M83). Urdu so far comes from the *Urdu frames; a native reviewer should check all of it before release.

240 keys, generated 2026-10-26.

## setup

- `setup.host_cable` — Cable
- `setup.host_wifi` — Wi-Fi
- `setup.host_other` — Other address
- `setup.busy` — Setting up…
- `setup.slow` — Still working…
- `setup.slow_body` — This can take 10 seconds. Don't close this page.
- `setup.offline_body` — What you typed stays here.
- `setup.err_code` — Check the code: 12 letters and digits
- `setup.err_host` — This is not an address of this hub
- `setup.err_cidr` — Check the ranges, e.g. 192.168.50.0/24
- `setup.already_title` — This hub is already set up
- `setup.already_body` — To add a screen, open Approve a screen on a manager's phone or tablet.
- `setup.done_title` — Hub is set up
- `setup.done_body` — Scan this with the owner's or manager's phone camera, or open the link on this laptop.
- `setup.restarting` — Hub restarting…
- `setup.ready` — Hub is ready
- `setup.wait_restart` — Wait for the restart
- `setup.open_here` — Open sign-in here
- `setup.link_meta` — Works once, for 30 minutes (until {time})
- `setup.link_expired_title` — This link has expired
- `setup.link_expired_body` — It was valid for 30 minutes. Ask support to make a new first-admin link.
- `setup.qr_expired` — QR expired
- `setup.link_cli` — Make a new link on the hub:

## bootstrap

- `bootstrap.loading` — Getting the staff list…
- `bootstrap.no_admins_title` — No one can open the hub admin
- `bootstrap.no_admins` — No one on the staff list can open the hub admin. Ask the owner.
- `bootstrap.not_admin` — This person can't open the hub admin.
- `bootstrap.not_admin_body` — Pick another name. If a name is gone from the list, that person was removed from the staff list.
- `bootstrap.pick_first` — Tap your name first.
- `bootstrap.expired_title` — This link has expired
- `bootstrap.expired_body` — Ask the installer for a new one. A link works once, for 30 minutes.
- `bootstrap.signed_in` — Signed in as {name}
- `bootstrap.idle_note` — Keep this tab open. Closing it signs you out.
- `bootstrap.idle_note_2` — You stay signed in for 1 hour without use.

## pin

- `pin.label` — PIN
- `pin.typed` — {n} digits typed
- `pin.wrong` — Wrong PIN
- `pin.tries_left` — Wrong PIN · {n} tries left
- `pin.length` — PIN is 4 to 6 digits
- `pin.locked_title` — Too many wrong PINs.
- `pin.locked_person` — {name} can try again in {min} min, or another admin can sign in.
- `pin.locked_ip` — Too many wrong PINs from this phone.
- `pin.locked_ip_body` — Try again in {min} min.
- `pin.locked_device` — Too many wrong PINs on this screen · {min} min
- `pin.locked_device_body` — Use another paired screen or wait.

## approve

- `approve.signin_chip` — Manager sign-in
- `approve.who` — Who's approving?
- `approve.who_sub` — Only people who can add screens are shown.
- `approve.needs_admin_title` — Can't approve on this phone
- `approve.first_admin_hint` — Setting up a new hub? Use the first-admin link on the installer's laptop.
- `approve.no_stations` — No kitchen stations are set up yet. Add them in the owner app.
- `approve.busy` — Approving…
- `approve.preview_cashier` — It opens the staff sign-in.
- `approve.audit_note` — Approving is recorded with your name.
- `approve.err_code_format` — The code has 6 letters and digits
- `approve.err_kind` — Pick what this screen is.
- `approve.err_station` — Pick the station.
- `approve.done_title` — Screen approved
- `approve.done_body_kds` — {station} kitchen screen will open in a few seconds.
- `approve.done_body_cashier` — The cashier screen will open in a few seconds.
- `approve.another` — Approve another
- `approve.failed` — Not approved
- `approve.retry` — Try again

## pairing

- `pairing.approve_needs_admin_device` — Open this on a paired admin device and type the code there.
- `pairing.code_aria` — Pairing code
- `pairing.starting` — Getting a pairing code…
- `pairing.starting_body` — This takes a few seconds.
- `pairing.hub_unreachable` — Can't reach the hub — retrying…
- `pairing.hub_unreachable_body` — The code still works. Nothing to do.
- `pairing.approved_title` — Paired
- `pairing.approved_body_cashier` — Opening the cashier screen…
- `pairing.approved_body_kds` — Opening the kitchen screen…
- `pairing.code_expired` — This code has expired. Get a new one, then ask again.
- `pairing.too_many` — Too many new codes from this screen. Wait {min} min, then get a new one.
- `pairing.new_code_in` — Get a new code in {time}
- `pairing.hub_busy` — The hub is busy and couldn't make a code.
- `pairing.new_code` — Get a new code
- `pairing.name_error` — Give the phone a name, up to 40 letters.
- `pairing.busy` — Pairing…
- `pairing.phone_hub_down_body` — Stay on the staff Wi-Fi. Your name is kept.
- `pairing.token_expired` — Ask a manager for a new QR
- `pairing.token_expired_body` — This QR works once, for 10 minutes.
- `pairing.token_expired_ios` — Then add the new link to your Home Screen; you can delete the old icon.
- `pairing.paired_title` — This phone is paired
- `pairing.paired_body_any` — Opening sign-in…

## global

- `global.hub_down_small` — What is on screen stays. It clears by itself.
- `global.repair_title` — This device must be paired again
- `global.repair_body` — A manager removed it, or its pairing is no longer valid. Pair it again, then ask a manager to approve it.
- `global.repair_phone_title` — This phone must be paired again
- `global.repair_phone_body` — Ask a manager for a new QR for your phone.
- `global.pair_again` — Pair again
- `global.wifi_body_unknown` — This phone is on the customer Wi-Fi. Switch to the staff Wi-Fi, then come back.
- `global.update_title` — Update the app
- `global.update_app_body` — The hub needs a newer version. Update the POS app from the Play Store, then open it again.
- `global.update_browser_body` — The hub has a newer version. Reload to get it.
- `global.reload` — Reload
- `global.busy` — Hub busy, try again.
- `global.busy_small` — Nothing was saved.
- `global.try_again` — Try again
- `global.not_set_up_title` — The hub is being set up
- `global.not_set_up_body` — This screen opens by itself when setup is done.
- `global.wrong_host_title` — Open the hub by its address
- `global.wrong_host_body` — Type the number address in the browser, not a name.
- `global.rotated_title` — Pair this device again
- `global.rotated_body` — This device's pairing was renewed on another copy of the app. Pair it again here.

## common

- `common.cancel` — Cancel

## admin

- `admin.back` — Back
- `admin.branch_line` — Branch hub · {host}
- `admin.tile_devices` — {n} paired
- `admin.tile_add_phone_title` — Add a phone for staff
- `admin.tile_add_phone` — Make a QR one person scans
- `admin.tile_sessions` — {n} people and kitchen screens
- `admin.tile_lockouts` — After 5 wrong PINs
- `admin.tile_stock` — Morning count, fresh batches
- `admin.not_seen_chip` — {name} not seen for {n} min
- `admin.locked_chip` — {name} locked · {min} min
- `admin.locked_many` — {n} locked out
- `admin.refreshed` — Refreshed {time}
- `admin.refresh` — Refresh
- `admin.offline` — Can't reach the hub — retrying…
- `admin.offline_body` — Showing the list from {time}. Buttons work again when the hub answers.

## devices

- `devices.add_phone` — Add a phone
- `devices.approve_short` — Approve
- `devices.group_cashier` — Cashier screens
- `devices.group_tablet` — Tablets
- `devices.group_removed` — Removed
- `devices.type_cashier` — Cashier screen
- `devices.type_tablet` — Tablet
- `devices.source_request` — Screen code
- `devices.source_token` — QR link
- `devices.seen_sec` — {n} s ago
- `devices.seen_min` — {n} min ago
- `devices.seen_never` — Not yet
- `devices.this_screen` — This screen
- `devices.nobody` — —
- `devices.removed_on` — Removed {date}
- `devices.read_only` — You can see screens and phones but can't remove them.
- `devices.read_only_body` — Ask a manager.
- `devices.first_run_title` — Add the other screens
- `devices.first_run_body` — Open Pair on each new screen, then approve its code here. Make a QR for each waiter's phone.
- `devices.removed` — {name} removed.
- `devices.removed_body` — It stopped working and anyone on it was logged out.
- `devices.already_removed` — {name} was already removed.
- `devices.remove_title` — Remove {name}?
- `devices.remove_body` — It will stop working at once and anyone logged in on it is logged out.
- `devices.remove_reason` — Reason (optional)
- `devices.remove_help` — Shown in the device list and the audit log
- `devices.remove_self` — This is the screen you are using. You will be signed out here, and it must be paired again before anyone can use it.

## errors

- `errors.DEVICE_NOT_FOUND` — This screen or phone is no longer on the list.
- `errors.SESSION_NOT_FOUND` — Already logged out.
- `errors.VALIDATION_FAILED` — Check the highlighted field.
- `errors.REGISTRATION_CODE_INVALID` — This code is wrong, used or older than 24 hours.
- `errors.REGISTRATION_CODE_INVALID_body` — Ask for a new one.
- `errors.REGISTRATION_CODE_KIND_UNSUPPORTED` — This code is for replacing a hub.
- `errors.REGISTRATION_CODE_KIND_UNSUPPORTED_body` — Use the replace-hub steps.
- `errors.SERVICE_UNAVAILABLE` — The hub is busy. Try again in a few seconds.
- `errors.SERVICE_UNAVAILABLE_cloud` — The cloud can't be reached.
- `errors.SERVICE_UNAVAILABLE_cloud_body` — Check the internet, then try again in {s} s.
- `errors.SETUP_IN_PROGRESS` — Setup is already running.
- `errors.SETUP_IN_PROGRESS_body` — Wait a moment.
- `errors.HOST_NOT_ALLOWED` — Open this page using the hub's IP address.
- `errors.HUB_NOT_PROVISIONED` — The hub is being set up.
- `errors.PAIRING_TOKEN_INVALID` — This link or code has expired. Ask for a new one.
- `errors.PIN_INVALID` — Wrong PIN. Try again.
- `errors.PIN_LOCKED_OUT` — Too many wrong PINs. Wait, then try again.
- `errors.DEVICE_LOCKED_OUT` — Too many wrong PINs on this screen. Wait, then try again.
- `errors.IP_LOCKED_OUT` — Too many tries from this device. Wait, then try again.
- `errors.STAFF_NOT_FOUND` — This person is not on the staff list.
- `errors.PERMISSION_DENIED` — You do not have permission for this. Ask a manager.
- `errors.PERMISSION_DENIED_devices` — You can't add screens.
- `errors.PERMISSION_DENIED_devices_body` — Ask a manager.
- `errors.PAIRING_REQUEST_NOT_FOUND` — No screen is waiting with this code. Check the code on the screen.
- `errors.STATION_NOT_FOUND` — This station is not set up.
- `errors.STATION_NOT_FOUND_body` — Add it in the owner app, then approve again.
- `errors.ADMIN_SESSION_REQUIRED` — You were signed out. Sign in again.
- `errors.DEVICE_TOKEN_INVALID` — This screen must be paired again.
- `errors.DEVICE_REVOKED` — This screen must be paired again.
- `errors.DEVICE_TYPE_NOT_ALLOWED` — This kind of screen cannot do that.
- `errors.DEVICE_NOT_OWNED` — This phone belongs to someone else.
- `errors.GUEST_NETWORK_FORBIDDEN` — Connect to the staff Wi-Fi.
- `errors.CLIENT_UPGRADE_REQUIRED` — Update the app.
- `errors.INTERNAL_ERROR` — Something went wrong on the hub. Try again.
- `errors.unknown` — Something went wrong. Try again.

## addphone

- `addphone.who` — Whose phone is it?
- `addphone.who_sub` — The QR pairs one phone. Only this person can sign in on it.
- `addphone.find` — Find a name
- `addphone.has_phones` — Has {n} phone
- `addphone.has_phones_many` — Has {n} phones
- `addphone.no_phone` — No phone yet
- `addphone.make_qr` — Make QR
- `addphone.pick` — Tap a name.
- `addphone.scan_title` — {name} scans this with their phone camera
- `addphone.scan_body` — Not the POS app: the normal camera. The link opens the POS on their phone.
- `addphone.valid` — Works once, for 10 minutes · {time}
- `addphone.expired_qr` — This QR has expired
- `addphone.expired` — Expired
- `addphone.new_qr` — Make a new QR
- `addphone.done` — Done

## sessions

- `sessions.title` — Signed in now
- `sessions.col_who` — Who
- `sessions.col_on` — On
- `sessions.col_activity` — Last activity
- `sessions.kind_staff` — Staff
- `sessions.kind_admin` — Hub admin
- `sessions.kind_station` — Kitchen screen
- `sessions.since` — {kind} · since {time}
- `sessions.idle_rule` — Signs out after {n} min idle
- `sessions.idle_rule_h` — Signs out after {n} h idle
- `sessions.stays_on` — Stays on until a manager ends it
- `sessions.idle_soon` — Signs out in {n} min
- `sessions.you` — You
- `sessions.hub_admin_device` — Hub admin link
- `sessions.log_out` — Log out
- `sessions.none` — No one is signed in.
- `sessions.read_only` — You can see who is signed in but can't log anyone out.
- `sessions.logout_title` — Log {name} out of {device}?
- `sessions.logout_body` — Anything they haven't sent stays on the {device}. They can sign in again with their PIN.
- `sessions.end_kds_title` — End the {station} kitchen screen session?
- `sessions.end_kds_body` — The {station} screen goes back to its start screen. Its tickets stay on the hub and print if no kitchen screen shows them.
- `sessions.end_kds` — End session
- `sessions.logged_out` — {name} logged out of {device}.
- `sessions.already_ended` — Already logged out.

## lockouts

- `lockouts.people` — People
- `lockouts.screens` — Screens
- `lockouts.addresses` — Addresses
- `lockouts.col_what` — Who or what
- `lockouts.col_locked` — Locked
- `lockouts.why_person` — 5 wrong PINs · until {time}
- `lockouts.why_screen` — 5 wrong PINs on this screen · until {time}
- `lockouts.why_ip` — First-admin sign-in · until {time}
- `lockouts.none_people` — No one is locked out.
- `lockouts.none_screens` — No screen is locked.
- `lockouts.none_ip` — No address is locked.
- `lockouts.read_only` — You can see lockouts but can't clear them.
- `lockouts.confirm_title` — Unlock {name} now?
- `lockouts.confirm_body` — They can try their PIN again. This is recorded with your name.
- `lockouts.confirm_ip_body` — The phone or laptop at this address can try a first-admin PIN again.
- `lockouts.unlocked` — {name} unlocked.
- `lockouts.unlocked_body` — They can try their PIN again now.
- `lockouts.already_unlocked` — Already unlocked.
