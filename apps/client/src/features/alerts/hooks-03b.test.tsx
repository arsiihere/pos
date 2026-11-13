import type { AlertCard } from '@pos/events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN, NOW, row } from '../../../test/alert-rows';
import { flush, mount, reply, type Mounted } from '../../../test/dom';
import { createAnswerSender } from './answer';
import { AnswerSheet } from './AnswerSheet';
import { Banners } from './Banner';
import { createPrintSkipDismiss } from './labels-03b';
import { OpenCard, PrintSkipContext, RowCard, type PrintSkipCtx } from './ui';

// 03b W0.6 (Q-58, Q-66, IR-22): the 01d / 02 alert screens consult lane A's labels-03b.ts for the 03b / 03c kinds —
// the card's help line and printer action (ui.tsx OpenCard), the closed line (ui.tsx RowCard, AnswerSheet), the
// escalated Ready's who line (Banner). One test per hook.

let m: Mounted;
afterEach(() => m?.unmount());

const printerCard = (problem: string): AlertCard => ({
  kind_label_key: 'alert.printer_problem.card',
  table_code: null,
  point_code: null,
  requester_name: null,
  device_name: null,
  details: { printer_name: 'Tandoor printer', problem },
});
const skip = row({
  alert_id: 'P1',
  kind: 'printer_problem',
  family: 'action',
  lock: { kind_label_key: 'alert.printer_problem.lock' },
  card: printerCard('ticket_not_built'),
});
const offline = row({
  alert_id: 'K1',
  kind: 'kds_offline',
  family: 'action',
  lock: { kind_label_key: 'alert.kds_offline.lock' },
  card: { kind_label_key: 'alert.kds_offline.card', table_code: null, point_code: null, requester_name: null, device_name: null, details: { station_name: 'Tandoor' } },
});
const BRANCH_ALLOWED = { grant: 'allowed' as const, scope: 'branch' as const };

function ctx(over: Partial<PrintSkipCtx> = {}): PrintSkipCtx & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ ok: true as const, data: { dismissed: true } }));
  return { grant: BRANCH_ALLOWED, dismiss: createPrintSkipDismiss(send, () => {}), toast: vi.fn(), send, ...over };
}

describe('[03b W0.6] alert screen hooks for the 03b / 03c kinds', () => {
  it('[03c §6.12 Q-53] open card: the printer card shows Dismiss with force-release-table-lock at branch, else "Stays until day close"; a tap dismisses once, not opening the card', async () => {
    const onOpen = vi.fn();
    const c = ctx();
    m = mount();
    m.render(
      <PrintSkipContext.Provider value={c}>
        <OpenCard row={skip} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />
      </PrintSkipContext.Provider>,
    );
    expect(m.text()).toContain('Tandoor printer · A ticket couldn\'t be built');
    expect(m.text()).toContain('Check that order on the kitchen screen.');
    // the card itself is a [role=button]: take the real <button>
    const dismiss = () => [...m.container.querySelectorAll('button')].find((b) => b.textContent === 'Dismiss');
    m.click(dismiss());
    m.click(dismiss());
    await flush();
    expect(c.send).toHaveBeenCalledOnce();
    expect(c.send.mock.calls[0]!.slice(0, 2)).toEqual(['DismissPrintSkip', { alert_id: 'P1' }]);
    expect(onOpen).not.toHaveBeenCalled();
    m.unmount();

    // without the grant, and with no provider (lock screens): the note, no button
    for (const node of [
      <PrintSkipContext.Provider key="g" value={ctx({ grant: { grant: 'not_granted' } })}>
        <OpenCard row={skip} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />
      </PrintSkipContext.Provider>,
      <OpenCard key="n" row={skip} nowMs={NOW} utcOffsetMs={0} onOpen={onOpen} />,
    ]) {
      m = mount();
      m.render(node);
      expect(m.text()).toContain('Stays until day close');
      expect(m.buttons().filter((b) => b.textContent === 'Dismiss')).toEqual([]);
      m.unmount();
    }
  });

  it('[03b §6.21] open card: the help line of kds_offline; an 01d card gets none', () => {
    m = mount();
    m.render(<OpenCard row={offline} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    expect(m.text()).toContain('Tandoor screen offline');
    expect(m.text()).toContain('Its tickets are on the Pass tablet.');
    m.unmount();
    m = mount();
    m.render(<OpenCard row={row({ alert_id: 'V' })} nowMs={NOW} utcOffsetMs={0} onOpen={() => {}} />);
    expect(m.text()).not.toContain('Stays until day close');
    expect(m.text()).not.toContain('Its tickets');
  });

  it('[03b §3.5; 03c Q-53] closed rows read the 03b / 03c lines (kind and problem passed to closedText); 01d rows unchanged', () => {
    const cases: Array<[Parameters<typeof row>[0], string]> = [
      [{ alert_id: 'R', kind: 'ready_to_serve', family: 'action', state: 'closed', close_reason: 'undone', lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: '4' } }, 'Pass took it back'],
      [{ ...skip, alert_id: 'S', state: 'closed', close_reason: 'done' }, 'Dismissed'],
      [{ ...skip, alert_id: 'S2', card: printerCard('paper_out'), state: 'closed', close_reason: 'done' }, 'Printing again'],
      [{ ...offline, alert_id: 'K', state: 'closed', close_reason: 'obsolete' }, 'Screen removed'],
      [{ alert_id: 'V', state: 'closed', close_reason: 'withdrawn' }, 'Withdrawn'],
    ];
    for (const [over, text] of cases) {
      m = mount();
      m.render(<RowCard row={row(over)} utcOffsetMs={0} onOpen={() => {}} />);
      expect(m.text(), text).toContain(text);
      m.unmount();
    }
  });

  it('[03b §3.5] AnswerSheet passes the kind too: a closed ready_to_serve reads "Pass took it back"', () => {
    const fetch = vi.fn(async () => reply(200, {}));
    const link = { isUp: () => true, subscribe: () => () => {} };
    const sender = createAnswerSender({ link, context: () => null, fetch, newCommandId: () => '01JCMD' });
    m = mount();
    m.render(
      <AnswerSheet
        row={{ ...row({ alert_id: 'R', kind: 'ready_to_serve', family: 'urgent', state: 'closed', close_reason: 'undone' }), answers: [], can_answer: false } as never}
        canAnswer={false}
        deviceId="D9"
        me={{ staffId: 'S-IMRAN', name: 'Imran' }}
        sender={sender}
        link={link}
        loadApprovers={async () => []}
        nowMs={NOW}
        utcOffsetMs={0}
        sheet={false}
        onClose={() => {}}
        onToast={() => {}}
      />,
    );
    expect(m.text()).toContain('Pass took it back');
  });

  it('[03b IR-22] an escalated Ready banner reads "Pass · nobody came for 2 min"; a first-step one and 01d rows keep the from line', () => {
    const ready = row({
      alert_id: 'E',
      kind: 'ready_to_serve',
      family: 'action',
      step: 1,
      escalation: true,
      raised_at: NOW - 2 * MIN - 5_000,
      lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: '4', point_code: 'Pass' },
    });
    m = mount();
    m.render(<Banners banners={[ready, row({ alert_id: 'V', raised_at: NOW - 3 * MIN })]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    const [first, second] = [...m.container.querySelectorAll('.abn .ac__who')];
    expect(first!.textContent).toBe('Pass · nobody came for 2 min');
    expect(second!.textContent).toContain('Hamza');
    m.unmount();
    m = mount();
    m.render(<Banners banners={[{ ...ready, escalation: false, step: 0 }]} nowMs={NOW} lockOnly={false} onOpen={() => {}} onOpenInbox={() => {}} />);
    expect(m.text()).not.toContain('nobody came');
  });
});
