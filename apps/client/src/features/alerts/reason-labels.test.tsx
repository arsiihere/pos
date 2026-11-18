import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, VOID_CARD, requestRow, row } from '../../../test/alert-rows';
import { mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { createAnswerSender, type HubLink } from './answer';
import { AnswerSheet, NoticeSheet } from './AnswerSheet';
import { detailsText, reasonText } from './labels';
import { detailLine } from './ui';

// 04 v1.0.5 §8 (the approver card), §3.5 (`details.reason` = `reason_code[: note]`), 01d v1.3.2 §3.12: a void
// reason code never shows raw; it reads through the existing `void.reason.*` labels (EN and UR), the note after it.
// An unknown code on a void card reads as the generic "Other". A comp reason is the branch's chip text: as stored.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

const hub: HubLink = { isUp: () => true, subscribe: () => () => {} };
const sender = createAnswerSender({ link: hub, context: () => null, fetch: vi.fn(), newCommandId: () => 'C' });

function approverCard(reason: string) {
  const r = requestRow({ alert_id: 'R1', card: { ...VOID_CARD, details: { ...VOID_CARD.details, reason } } });
  m = mount();
  m.render(
    <AnswerSheet
      row={r}
      canAnswer
      deviceId="D9"
      me={{ staffId: 'S-IMRAN', name: 'Imran' }}
      sender={sender}
      link={hub}
      loadApprovers={async () => []}
      nowMs={NOW}
      utcOffsetMs={0}
      sheet={false}
      onClose={() => {}}
      onToast={() => {}}
    />,
  );
  return m.text();
}

describe('[04 §8; 01d §3.12] void reason labels', () => {
  it('[04 §8] the approver card shows "Customer changed mind", never customer_changed_mind', () => {
    const text = approverCard('customer_changed_mind');
    expect(text).toContain('“Customer changed mind”');
    expect(text).not.toContain('customer_changed_mind');
  });

  it('[04 §8] Other with its note; another code with a note; an unknown code → the generic "Other", never the raw string', () => {
    expect(approverCard('other: Spilled on the floor')).toContain('“Other: Spilled on the floor”');
    m!.unmount();
    expect(approverCard('quality: Too salty')).toContain('“Quality: Too salty”');
    m!.unmount();
    const unknown = approverCard('stale_code_from_a_newer_hub');
    expect(unknown).toContain('“Other”');
    expect(unknown).not.toContain('stale_code_from_a_newer_hub');
  });

  it('[04 §8; 01d §3.12] Urdu: the void.reason.* label', () => {
    setLanguage('ur');
    expect(approverCard('wrong_order_taken')).toContain('غلط آرڈر لیا');
  });

  it('[01d §3.12] the inbox line, the card text and the NoticeSheet Reason row use the same labels', () => {
    const card = { ...VOID_CARD, details: { ...VOID_CARD.details, reason: 'too_late' } };
    m = mount();
    m.render(<div>{detailLine(card, false)}</div>);
    expect(m.text()).toContain('“Too late”');
    expect(m.text()).not.toContain('too_late');
    m.unmount();
    expect(detailsText(card.details, card)).toContain('“Too late”');
    // a result notice about a void: its Reason row
    const notice = row({
      alert_id: 'N1',
      kind: 'request_result',
      family: 'info',
      set: 'recipient',
      outcome: 'approved',
      card: { kind_label_key: 'alert.request_result.card', table_code: '12', point_code: null, requester_name: 'Hamza', device_name: null, details: { item: 'Karahi', reason: 'customer_changed_mind' } },
    });
    m = mount();
    m.render(<NoticeSheet row={notice} utcOffsetMs={0} sheet={false} onClose={() => {}} />);
    expect(m.text()).toContain('Customer changed mind');
    expect(m.text()).not.toContain('customer_changed_mind');
  });

  it('[02b Q-19] a comp reason is the branch\'s chip text: shown as stored; a closer\'s free note too', () => {
    expect(reasonText('Spilled', { kind_label_key: 'alert.comp.card' })).toBe('Spilled');
    expect(reasonText('Guest left early', { kind_label_key: 'alert.request_result.card' })).toBe('Guest left early');
    expect(reasonText('', { kind_label_key: 'alert.void_approval.card' })).toBeNull();
  });
});
