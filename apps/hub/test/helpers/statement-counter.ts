import type Database from 'better-sqlite3';

export function statementCounter(db: Database.Database): { readonly count: number; reset(): void } {
  let count = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const counted =
      <A extends unknown[], R>(original: (...args: A) => R) =>
      (...args: A): R => {
        count += 1;
        return original(...args);
      };
    statement.get = counted(statement.get.bind(statement));
    statement.all = counted(statement.all.bind(statement));
    statement.run = counted(statement.run.bind(statement));
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
