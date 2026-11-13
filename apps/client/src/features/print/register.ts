// stub (W0.5); owned by lane A, task A4

/**
 * 03c §3.5, §3.8 (D12, Q-50): registers 03c's `printed` tag and Reprint actions into `features/kds/slots.ts`
 * (line tag, line action, Pass card action, frame subscription). Called once by each 03b screen's entry (KDS, Pass)
 * at module scope, before it renders — never inside a component or effect (StrictMode runs those twice, which would
 * register twice). Returns the unregister function. The stub registers nothing.
 */
export function registerPrintSlots(): () => void {
  return () => {};
}
