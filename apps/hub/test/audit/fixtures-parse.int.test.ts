import { AUDIT_ACTIONS, toAuditEntry } from '@pos/domain';
import { latestVersion, parseEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { fixtures, L } from '../../../../packages/domain/src/audit.fixtures';

// 04 §10 test 50, the schema half: every toAuditEntry fixture of @pos/domain is a real event. Each one is parsed with
// the @pos/events registry (latest version) before it is mapped, so a renamed or stripped payload field fails here
// instead of silently mapping to null.

describe('[04 #50] audit fixtures parse as real events', () => {
  it('[04 #50] every fixture parses unchanged, and its parsed event maps to the same entry', () => {
    const all = fixtures();
    expect(new Set(all.map((f) => f.action))).toStrictEqual(new Set(AUDIT_ACTIONS));
    for (const { action, event } of all) {
      const parsed = parseEvent({
        ...event,
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        schema_version: latestVersion(event.event_type),
        occurred_at: event.recorded_at,
      });
      expect(parsed.payload, `${event.event_type} (${action})`).toStrictEqual(event.payload);
      const entry = toAuditEntry(parsed, L);
      expect(entry?.action, event.event_type).toBe(action);
      expect(entry, event.event_type).toStrictEqual(toAuditEntry(event, L));
    }
  });
});
