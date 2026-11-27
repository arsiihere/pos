import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDemoHub, type DemoOrder } from './demo-hub';

// 02b-TK L-CLIENT-6a proof (playwright.fidelity.config.ts): two demo hubs — `busy` with the HomeKiosk queue (ready
// paid / due / late / part, cooking, a phone order for later), `empty` with no orders (HomeEmpty). Never in the gate.

export const BUSY: DemoOrder[] = [
  { key: 'kamran', name: 'Kamran', phone: '03001112233', lines: [['I_SEEKH', 1]], stage: 'done', paid: true, after: 17 },
  { key: 'ali', name: 'Ali', lines: [['I_CK_H', 1], ['I_RNAAN', 4]], stage: 'done', paid: true },
  { key: 'due', lines: [['I_QEEMA', 1], ['I_RNAAN', 4]], stage: 'done' },
  { key: 'ayesha', name: 'Ayesha', lines: [['I_PAYE', 1], ['I_MK_H', 1]], stage: 'part', paid: true },
  { key: 'bilal', name: 'Bilal', lines: [['I_CK_H', 1], ['I_RNAAN', 4], ['I_LASSI_S', 2]], paid: true },
  { key: 'walk1', lines: [['I_PAYE', 2], ['I_LASSI_S', 2]] },
  { key: 'hamza', name: 'Hamza', lines: [['I_TAWA', 1], ['I_ROTI', 3]], paid: true },
  { key: 'walk2', lines: [['I_SEEKH', 2], ['I_RAITA', 1]], paid: true },
  { key: 'saima', name: 'Saima', phone: '03214567890', lines: [['I_MK_F', 1], ['I_NAAN', 8]], pickupMin: 75 },
];

export default async function setup(): Promise<() => Promise<void>> {
  const busy = await startDemoHub(BUSY);
  const empty = await startDemoHub([]);
  const file = join(tmpdir(), `pos-fidelity-${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ busy: busy.info, empty: empty.info }));
  process.env['POS_FIDELITY'] = file;
  return async () => {
    await busy.hub.close();
    await empty.hub.close();
  };
}
