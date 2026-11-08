// AD-6 / AD-8(c): a writer bug or invalid data found by a fold or a placement. Strict folds throw it.
// Non-strict: a listed bad line is dropped and still decrements awaiting (foldItemAdded); anything else changes
// nothing but the diagnostics (applyEvent catches it); either way one 'invalid_event' diagnostic is appended.
// Its own module so plan.ts and replan.ts share it without an import cycle (plan.ts re-exports it).
export class InvalidEvent extends Error {
  constructor(
    readonly reason: string,
    readonly order_item_id: string,
    readonly station_id?: string,
  ) {
    super(`invalid event (${reason}) for line ${order_item_id}${station_id === undefined ? '' : ` on station ${station_id}`}`);
    this.name = 'InvalidEvent';
  }
}
