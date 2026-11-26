# 03a manual checks

Hand checks for the 03a timing engine on the pilot hardware. The owner runs them on the pilot mini PC. They never run in the cloud or in CI. Nothing here is run or ticked by the build.

How to fill it in: tick `[x]` when the step behaves as written. When it does not, leave `[ ]` and write what you saw in **Notes**. Fill in the **Done by / date** line under each check.

How to report it: `tools/local/checks-report.sh <PR> docs/plans/03a-manual-checks.md` posts the filled-in list as a comment on the PR.

The pilot-box performance checks of 03a task 28 (`docs/plans/03a-release-notes.md` item 4) are not written here yet; they are added when task 28 runs.

---

## 1. Engine v6 install, after hours (03a v1.2.11 §3.12, §3.5.8 PK-11, §11 note; 02b-TK lane L-ENG task E-10)

Why: v1.2.11 bumps `ENGINE_STATE_VERSION` 5 → 6 (the meaning of the folds changes for pickup orders, D62). At boot the hub skips every v5 snapshot (`engine_version`) and replays the log from the day-close checkpoint. So the update is installed **after the day's close**, once its day-close checkpoint is written: the replay then starts from a checkpoint that holds no lines. 02b v1.0.25 (the takeaway pickup) ships only with this engine or later, never before it.

1. [ ] The day is closed (Close business day on the staff app or `/admin/stock`), and no order is still in the kitchen (every line served, or more than 30 min since the last serve).
2. [ ] The day-close checkpoint is written: on the mini PC, `sqlite3 <data_dir>/hub.sqlite "SELECT last_seq, datetime(taken_at / 1000, 'unixepoch', 'localtime') FROM engine_checkpoints ORDER BY last_seq DESC LIMIT 1"` (`data_dir` in `/etc/pos-hub/config.json`) shows a row taken **after** the close. If there is no such row, wait (an order kept over the close defers it, §3.12) and check again; do not install yet.
3. [ ] `sudo systemctl stop hub`, install the build (check out the commit in `/opt/pos-hub`, ship the client), `sudo systemctl start hub`.
4. [ ] The boot log (`journalctl -u hub -b`) has one `engine boot: unreadable row skipped` warning per v5 snapshot with `table: engine_snapshots`, `reason: engine_version`, `found: 5` (expected), none for `engine_checkpoints`, and `engine boot` lines for steps 2 and 3 with `snapshot_seq: null` and `checkpoint_seq` = the row of step 2.
5. [ ] `http://<hub>/health` answers; open the next business day; a test order goes through to the KDS and back (Start, Done, Served).
6. [ ] Shortly after startup (a boot that loaded no v6 snapshot writes a fresh one, §3.12) `SELECT engine_version FROM engine_snapshots` shows `6` only.

Notes:

Done by / date:
