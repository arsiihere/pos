// 03a §3.12 (v0.4, G2 #3): the replay filter per stream, and exactly the event types applyEvent handles.
export const ENGINE_REPLAY_EVENTS = {
  order: [
    'OrderPlaced',
    'OrderLinesAdded',
    'ItemAdded',
    'ItemStarted',
    'ItemDone',
    'ItemDoneUndone',
    'ItemServed',
    'ItemRemoved',
    'ItemVoided',
    'ItemMovedToStock',
    'ItemReturned',
    'OrderBoosted',
    'ItemsReleased',
    'SlipWarned',
    'AlertClosed',
  ],
  station: ['FireDispatched', 'ReservationsShifted', 'EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet'],
  // 03a v1.2 Q-5: StockTransferredOut (02b zone refill), folded as a negative StockAdded.
  stock: ['StockSet', 'StockAdded', 'StockReserved', 'StockReleased', 'StockConsumed', 'StockTransferredOut'],
  hub: ['BusinessDayOpened', 'BusinessDayClosed'],
} as const satisfies { order: readonly string[]; station: readonly string[]; stock: readonly string[]; hub: readonly string[] };

// The union of the lists: the type of applyEvent's switch, exhaustive both ways (test 94).
export type ReplayEventType = (typeof ENGINE_REPLAY_EVENTS)[keyof typeof ENGINE_REPLAY_EVENTS][number];
