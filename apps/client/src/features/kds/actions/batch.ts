import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { LoadResult } from './actions';

// 03b §3.2 (K3; frames KdsBatch, KdsBatchStarted, KdsBatchDone): a batch station starts / finishes a whole load
// with one tap (the hub answers every member id). Before a tap there is no grouping (handoff Q-2: no box); after it
// the changed rows are highlighted together and one info line says what happened, for a few seconds.

export const LOAD_NOTICE_MS = 5_000;

export interface LoadNotice {
  ids: ReadonlySet<string>;
  text: string;
}

export function loadNotice(r: LoadResult): LoadNotice {
  return {
    ids: new Set(r.ids),
    text: r.kind === 'started' ? fill(t('kds.batch_started'), { n: String(r.ids.length) }) : t('kds.batch_done'),
  };
}
