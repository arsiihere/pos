// 02b-TK C1-5 with 01d v1.3.3 §3.13.2 rule 6 (#105): a deep link (an alert's or request's target) leaves the order
// screen without the leave guard's question — its close and the kiosk Back chip return to the cart, which stays on
// this device as it was (not held). StaffApp's deepNavigate names the route it is about to open; the guard lets that
// one hash change through.

let passTo: string | null = null;

/** The next hash change to `href` passes the leave guard. */
export function letLeavePass(href: string): void {
  passTo = href;
}

/** True once for the route named by letLeavePass; any hash change the guard sees ends the pass. */
export function takeLeavePass(to: string): boolean {
  const ok = passTo !== null && passTo === to;
  passTo = null;
  return ok;
}
