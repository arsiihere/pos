import todo05 from '../../../../../docs/design/handoff/05/urdu-todo.md?raw';

// Test support (task 43a): the keys of docs/design/handoff/05/urdu-todo.md. The rows' backticks are unbalanced
// (`a.b/ `.c``), so each first cell is split on them: a `.c` piece replaces the last segment of the row's base key,
// a `_c` piece is appended to it (`errors.BILL_NOT_OPEN` + `_cancelled`).
export function todoKeys(md: string): Set<string> {
  const keys = new Set<string>();
  for (const line of md.split('\n')) {
    if (!line.startsWith('| `')) continue;
    let base: string | null = null;
    for (const raw of (line.split('|')[1] ?? '').split('`')) {
      const tok = raw.trim().replace(/\/$/, '').trim();
      if (tok === '') continue;
      if (tok.startsWith('.') || tok.startsWith('_')) {
        if (base !== null) keys.add(tok.startsWith('.') ? base.slice(0, base.lastIndexOf('.')) + tok : base + tok);
      } else if (tok.includes('.') && !tok.includes(' ')) {
        keys.add((base = tok));
      }
    }
  }
  return keys;
}

/** The 05 hand-off's Urdu to-do keys. */
export const TODO_05: ReadonlySet<string> = todoKeys(todo05);
