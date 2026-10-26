// S52: the chosen branch is kept per tab; branches show as their ID tail until 01b names them.
const BRANCH_KEY = 'owner_branch_id';

export function idTail(branchId: string): string {
  return `…${branchId.slice(-4)}`;
}

export function storedBranch(allowed: readonly string[], storage: Storage = sessionStorage): string | null {
  if (allowed.length === 1) return allowed[0] ?? null;
  const stored = storage.getItem(BRANCH_KEY);
  return stored !== null && allowed.includes(stored) ? stored : null;
}

export function storeBranch(branchId: string | null, storage: Storage = sessionStorage): void {
  if (branchId === null) storage.removeItem(BRANCH_KEY);
  else storage.setItem(BRANCH_KEY, branchId);
}
