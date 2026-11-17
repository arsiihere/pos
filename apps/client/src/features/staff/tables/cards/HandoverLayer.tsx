import { MyRequestRow } from '@pos/events';
import { useEffect, useRef } from 'react';
import { useShell, type Shell } from '../../shell/hooks';
import { useTableLock } from '../lock/useTableLock';
import { pendingHandovers, type MyRequest } from './pending-handovers';
import { forceMoveNotice } from './ResultBanner';

// 02a §8 Table sheet, Handover waiting card (02a-C02–C05; Q-14), §8 Banners (ForceMovedToMe): the layer over
// every signed-in screen (mounted by StaffApp while someone is signed in). It connects the pending-handover store
// to `my-requests` (read on mount, on a socket reconnect and when the page becomes visible; the 01d banner rows
// report request_result alerts, Banner.tsx) and raises the force-move notice to the new holder (its manager name,
// time, reason and total are not in the W0.4 LockBannerState: deferred). The cards themselves render in the one
// 01d banner stack (Banner.tsx), so they follow its phone / wide variant and never overlap it. Sign-out unmounts
// the layer: the person's handovers, results and notice are dropped.

async function loadMyRequests(shell: Shell): Promise<{ ok: true; data: { requests: MyRequest[] } } | { ok: false; error: { kind: 'network' } }> {
  const answer = await shell.api.query<{ requests?: unknown }>('/queries/my-requests');
  if (!answer.ok) return { ok: false, error: { kind: 'network' } };
  const rows = Array.isArray(answer.data?.requests) ? answer.data.requests : [];
  const requests: MyRequest[] = [];
  for (const r of rows) {
    const parsed = MyRequestRow.safeParse(r);
    if (parsed.success) requests.push(parsed.data);
  }
  return { ok: true, data: { requests } };
}

export function HandoverLayer() {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const staff_id = shell.me?.staff_id ?? null;
  // the map's lock listener: a force move of any table to me
  const lock = useTableLock(null);
  const notice = lock.banner !== null && lock.banner.kind === 'force_moved_to_me' ? lock.banner : null;
  useEffect(() => forceMoveNotice.set(notice, shellRef.current.clock.nowMs()), [notice]);

  useEffect(() => {
    if (staff_id === null) return;
    pendingHandovers.connect({ staff_id, load: () => loadMyRequests(shellRef.current), now: () => shellRef.current.clock.nowMs() });
    void pendingHandovers.refresh();
    const off = shellRef.current.live.subscribe((m) => {
      if (m.kind === 'reconnect' || m.kind === 'visible') void pendingHandovers.refresh();
    });
    return () => {
      off();
      pendingHandovers.disconnect();
      forceMoveNotice.set(null);
    };
  }, [staff_id]);

  return null;
}
