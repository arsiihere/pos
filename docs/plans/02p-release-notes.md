# 02p release notes (platform changes)

Release lines for the 02p sprint, collected as tasks land. Snapshot V3 and V4 ship together (02p U5, R29).

- **Re-seed (R29, task 9):** dev and pilot tenants are re-seeded so the new default grants exist (01b v1.6 B-1, v1.7 §6.15: `take-order`, `clean-table`, `set-line-weight`, `view-customer-contact`, `apply-comp`, `boost-order`, `manage-zone-stock`). No migration rewrites grants (01b B6).
- **Snapshot V4 (task 4):** cloud and every hub released together; a hub with V3 stored does a full apply (01a #188).
- **Settings version (task 9):** every branch's settings version changes once at deploy (the hash input gained the new fields); an owner-app form open across the deploy gets one `409 CONFIG_STALE`.
- **Staff version (task 7, AD-22):** every stored staff version changes once at deploy (`assignments` joined the version input).
