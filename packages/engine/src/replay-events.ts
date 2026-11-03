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
  stock: ['StockSet', 'StockAdded', 'StockReserved', 'StockReleased', 'StockConsumed'],
  hub: ['BusinessDayOpened', 'BusinessDayClosed'],
} as const satisfies { order: readonly string[]; station: readonly string[]; stock: readonly string[]; hub: readonly string[] };
