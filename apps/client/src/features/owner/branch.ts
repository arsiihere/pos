import { createContext, useContext } from 'react';

// S52: the chosen branch is kept per tab. S58: branches show by name from GET /v1/admin/branches; the ID tail
// shows until the names arrive, or when that read fails.
const BRANCH_KEY = 'owner_branch_id';

export function idTail(branchId: string): string {
  return `…${branchId.slice(-4)}`;
}

export const BranchNames = createContext<ReadonlyMap<string, string>>(new Map());

export function useBranchName(): (branchId: string) => string {
  const names = useContext(BranchNames);
  return (branchId) => names.get(branchId) ?? idTail(branchId);
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
