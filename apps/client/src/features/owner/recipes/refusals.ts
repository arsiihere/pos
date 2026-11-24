import type { CloudError } from '../../../api/cloud-admin';

// B17 (AD-9): a 01c / 08a write refused because a recipe uses the row: the recipe ids, else null.
export function recipeInUseIds(error: CloudError): string[] | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const usedBy = error.details['used_by'] as { entity?: unknown; ids?: unknown } | undefined;
  if (usedBy?.entity !== 'recipe') return null;
  return Array.isArray(usedBy.ids) ? usedBy.ids.filter((id): id is string => typeof id === 'string') : [];
}

// §6.6 N-1 / T-1: a restore refused with hint new_draft (the old version cannot come back): its reason, else null.
export function newDraftReason(error: CloudError): string | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_REFERENCE_INVALID' || error.details['hint'] !== 'new_draft') return null;
  return typeof error.details['reason'] === 'string' ? error.details['reason'] : '';
}
