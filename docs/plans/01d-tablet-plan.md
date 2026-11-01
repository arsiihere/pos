# 01d Tablet app (batch 9b) — Implementation Plan (short)

> **Status: BLOCKED — tablet model (OQ2).** Do not start until the developer names the pilot tablet (model, Android version, whether it can be provisioned as device owner). Runs alongside 01e. **Not required for the 01d merge; required before the pilot** (01d plan AD-1, like 01b T59–T62).
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. When unblocked, expand each task below to the 01d plan's step format (failing test, run, implement, run, commit) before building.

**Goal:** The bundled Capacitor tablet app: the 01d `staff` entry (01d plan batch 9a) as bundled assets, a native background service holding the alert-mode connection with locked-screen notifications, lock-task / device-owner provisioning, and the hub-hosted silent update client.

**Spec:** `docs/specs/01d_Notifications_Requests_Spec_v1.0.md` §8.2, §8.4, §3.7, §8.1 (one notification per alert), test #63; `docs/specs/00_Hub_Platform_Access_Spec_v1.6.md` H-5 (§6.36–§6.38, client side), §8.1 (token storage); foundation v1.8 §1 Android row (F-3); README R22, R33.

**Depends on:** 01d merged (batch 9a's `staff` entry, the alert-mode WS H-1, `alerts_open` with `binding_route_until`, `GET /app/android/latest` and `.apk`); the tablet model (OQ2); one release signing key, backed up in two places.

## Global Constraints

- Everything in `docs/plans/01d-plan.md` Global Constraints applies (opus agents, controller-only gate, TDD, one task per commit citing the spec, AD rows proposed, push after each batch).
- **Dependencies:** `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` are approved for this plan only (developer, 2026-11-01), exact versions pinned. Any other npm or Gradle dependency (e.g. a WebSocket client for the native service) is a question for the developer first.
- **Layout:** `apps/tablet/` (Capacitor project; `webDir` = the built `apps/client/dist/staff/`; bundled assets, no live-reload URL in release builds). The native plugin lives in `apps/tablet/android/…/alertservice/`; its JS bridge in `apps/client/src/features/alerts/service-bridge.ts` (no Capacitor import in `apps/client`: the bridge takes the plugin as an injected interface, so the gate builds without Capacitor).
- **Tests:** JS parts (bridge, update decision) in the Vitest gate; native code in Gradle unit / instrumented tests, outside the gate, run by the controller on the real tablet with the command and result recorded in `docs/plans/01d-status.md`.
- **Secrets:** the service holds the device token only (Keystore-backed, 00 §8.1), never the session token, never a PIN.

## Tasks

| # | Task | RISK | Spec | Test |
|---|---|---|---|---|
| T1 | Capacitor shell over the bundled `staff` entry; device token in Keystore-backed storage; pairing flow as the browser page | HIGH (device auth) | F-3, 00 §8.1, R33 | JS: bridge reads the token through the plugin interface; native: token survives restart, not readable by other apps |
| T2 | Native `AlertService`: Android foreground service holding the alert-mode WS (`auth` with device token only), `alerts_open` on connect, Android notification with the `lock` text and the family's sound / vibration (§8.3), `receipt delivered` per `(alert_id, step)`, reconnect backoff ≤ 5 s, `4403` / `4401` stop and clear, `4409` logged | HIGH (alert-mode WS auth) | §8.2, §3.7, H-1 | native instrumented: notification shown with the screen off; receipt sent once per step |
| T3 | One notification per alert on a signed-in tablet: the page reports each shown `(alert_id, step)`; the service holds its own for 1 s and stays silent for a reported pair; signed out or page silent for 1 s → the service notifies alone; the page never opens alert mode | NORMAL | §8.2 (v0.5 m6), §3.7 | `[01d #63]` on `service-bridge.ts` with a fake plugin |
| T4 | Lock-task / device-owner provisioning runbook and policy: app whitelisted from battery optimisation, lock-task allowlist, boot start | NORMAL | §8.2, R33 (G0 D1) | manual on the tablet |
| T5 | Silent update client: `GET /app/android/latest` after each reconnect and hourly; download when `version_code` is higher; verify `sha256`; install with `PackageInstaller` only when no session is signed in, the business day is closed, or in the M66 maintenance hour; `426 CLIENT_UPGRADE_REQUIRED` as the hard trigger | HIGH (installs code) | §8.4, H-5 | JS: the install-window and version decision (`app-update.ts`, pure); native: `sha256` mismatch refuses install |
| T6 | Manual checks on the real tablet (`docs/plans/01d-tablet-manual-checks.md`) | — | §12.1 DoD | below |

**T6 manual checks:**
1. **Screen off:** a session-less tablet bound to Ali, screen off → a `test_alert` to Ali from a manager's device gives an Android notification with the `lock` text and sound; `alert-receipts` shows delivered, then seen after Ali opens it (01d §12.1 DoD, first half).
2. **Alert mode after the session idles out:** a waiter signed in on the tablet, idle past 5 min → an `action` alert still rings through the service; after 2 h without activity the header says "Alerts paused" and the alert goes "for" the lead.
3. **One notification per alert** while signed in (page and service): one banner, one sound, one 10 s repeat.
4. **Staged update:** `app-release add --stage T1` → only T1 installs, in an allowed window; `mark-good` → T2 installs; the alert connection comes back after the install.
5. **Release key:** the signing key is backed up in two places (installation runbook).

## Open questions (for the developer, before T1)

| # | Question |
|---|---|
| OQ2 | Tablet model and Android version; can it be provisioned as device owner (factory reset + QR / `adb dpm set-device-owner`)? |
| TQ1 | WebSocket client for the native service: the Android platform has none built in; OkHttp is the usual choice (a Gradle dependency). Approve OkHttp, or keep the socket in a WebView-free JS runtime? |
| TQ2 | Kotlin or Java for the plugin (no preference in the spec) |
