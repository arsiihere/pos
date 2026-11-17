import type { HubResult } from '../../api/hub-admin';
import type { RosterPerson } from '../staff/api';

// 03b v1.0.8 §6.15 (P1; owner Q-55): the Pass shows a staff id (`ready.by`) as a name. Event frames carry no actor,
// so a name is: the person signed in on this tablet when it sent the command (`remember`), else the `staff-roster`
// name of the id (read at each catch-up that holds a `point_view`, never on a timer), else none — `fillLine` then
// drops that part. A reply older than the newest read never wins; a failed read keeps the last names.

export interface PassNames {
  /** the name for a staff id, or null (unknown id, no id) */
  name(staff_id: string | null): string | null;
  /** the person signed in on this tablet (for what this tablet sent) */
  remember(staff_id: string, name: string): void;
  /** one `staff-roster` read */
  refresh(): void;
  subscribe(listener: () => void): () => void;
}

export function createPassNames(load: () => Promise<HubResult<{ staff: RosterPerson[] }>>): PassNames {
  let roster = new Map<string, string>();
  const own = new Map<string, string>();
  let asked = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const fn of [...listeners]) fn();
  };
  return {
    name: (staff_id) => (staff_id === null ? null : (own.get(staff_id) ?? roster.get(staff_id) ?? null)),
    remember(staff_id, name) {
      if (own.get(staff_id) === name) return;
      own.set(staff_id, name);
      changed();
    },
    refresh() {
      const mine = (asked += 1);
      void load().then(
        (answer) => {
          if (mine !== asked || !answer.ok) return;
          roster = new Map(answer.data.staff.map((p) => [p.staff_id, p.display_name]));
          changed();
        },
        () => undefined,
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
