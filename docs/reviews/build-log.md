# Build log — module 00

## Task 2 — domain ids, enums, error catalogue
Commit `76bad33`. Tests: `[F §6.2]` catalogue scan and DomainError details, `[00 §9]` spec 00 statuses, `[F §6.6]` ULID_RE. Full suite 4/4.
Assumed the catalogue is the v1.0 list in the current plan (includes `HOST_NOT_ALLOWED`, `STATION_LOGOUT_NOT_ALLOWED`, `PAIRING_REQUEST_NOT_FOUND`, `IP_LOCKED_OUT`, and `credentials_changed` on `SessionEndReason`). `details` defaults to `{}`. ULID check uses the foundation example and rejects `I`.

## Task 3 — permission catalogue
Commit `96129e3`. Tests: `[00 §10 #74]` unknown permission throws naming it; `[00 §3.6]` 19 unique entries. Full suite 6/6.
Catalogue order is the E6 AC2 list from stories, then `manage-devices` and `access-hub-admin`. `assertKnownPermissions` throws `Error` on the first unknown name.
