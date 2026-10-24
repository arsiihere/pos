import type Database from 'better-sqlite3';

export function statementCounter(db: Database.Database): { readonly count: number; reset(): void } {
  let count = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    for (const method of ['get', 'all', 'run'] as const) {
      const original = statement[method].bind(statement);
      statement[method] = ((...args: unknown[]) => {
        count += 1;
        return original(...args);
      }) as typeof statement.get;
    }
    return statement;
  }) as typeof db.prepare;
  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}
