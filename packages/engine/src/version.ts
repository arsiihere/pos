// D62: bumped when the EngineState shape or applyEvent's meaning changes (01c task 8: business_day v2;
// 03a §3.3: v3 adds config, stations, orders, lines, slips, next_alert_due_at, slip_due;
// 03a v1.2.2 (owner 2026-11-11, B2-2): v4 adds EngineLine.done_undone;
// 03a v1.2.10 §3.3 (STAB-6, STAB-7): v5 adds EngineLine.max_delay_ms / priority_at / arrived_at,
// groups[].priority_land_ms / priority_delay_ms and EngineState.priority_due).
// 03a §3.5.8 PK-11: v6 replays pickup orders under the whole-order hold rules.
export const ENGINE_STATE_VERSION = 6;
