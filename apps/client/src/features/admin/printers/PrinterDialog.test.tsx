import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import type { HubError } from '../kitchen-screens/api';
import type { SavePrinterPayload } from './api';
import { PrinterDialog } from './PrinterDialog';
import { PRINT_CONFIG } from './test-data';

let m: Mounted;

beforeEach(() => {
  m = mount();
});

afterEach(() => m.unmount());

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function fields() {
  const inputs = [...m.container.querySelectorAll<HTMLInputElement>('[role="dialog"] input')];
  return { name: inputs[0]!, address: inputs[1]! };
}

function errorOf(label: string): string | null {
  const field = [...m.container.querySelectorAll('.pos-field')].find((f) => f.querySelector('.pos-field__label')?.textContent === label);
  return field?.querySelector('.pos-field__error')?.textContent ?? null;
}

describe('printer dialog (03c-D01)', () => {
  it('[03c §6.2] SavePrinter: name 1–40, LAN host / USB path, paper 58 | 80; CONFIG_NAME_TAKEN on the field', async () => {
    const sent: SavePrinterPayload[] = [];
    let answer: HubError | null = { kind: 'api', status: 409, code: 'CONFIG_NAME_TAKEN', details: { entity: 'printer', name: 'Tandoor printer' } };
    const save = vi.fn(async (p: SavePrinterPayload) => {
      sent.push(p);
      return answer;
    });
    const onClose = vi.fn();
    m.render(<PrinterDialog printer={null} save={save} onClose={onClose} />);
    expect(m.text()).toContain('Add printer');
    // an empty name and a public address are refused on their fields, nothing is sent
    type(fields().address, '8.8.8.8:9100');
    m.click(m.button('Save'));
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(errorOf('Name')).toBe('Give the printer a name');
    expect(errorOf('Address')).toBe('Use a private network address like 192.168.1.50:9100');
    expect(fields().name.maxLength).toBe(40);
    type(fields().name, 'x'.repeat(41));
    type(fields().address, '192.168.1.50');
    m.click(m.button('Save'));
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(errorOf('Name')).toBe('1–40 letters, different from your other printers');
    type(fields().name, '  Tandoor printer  ');
    type(fields().address, '192.168.1.50');
    m.click(m.button('58 mm'));
    m.click(m.button('Save'));
    await flush();
    expect(sent).toEqual([{ name: 'Tandoor printer', connection: 'lan', address: '192.168.1.50', paper_width_mm: 58, archived: false }]);
    expect(errorOf('Name')).toBe('Another printer has this name');
    expect(onClose).not.toHaveBeenCalled();
    // USB: a device path; the hub's address issue lands on the Address field
    m.click(m.button('USB'));
    expect(m.text()).toContain('/dev/usb/lp0 or /dev/pos-printer-… from the install guide');
    type(fields().address, '/dev/sda');
    m.click(m.button('Save'));
    await flush();
    expect(errorOf('Address')).toBe('Use /dev/usb/lp0 or /dev/pos-printer-… from the install guide');
    expect(sent).toHaveLength(1);
    type(fields().address, '/dev/usb/lp0');
    answer = { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: { issues: [{ path: 'address', message: 'x' }] } };
    m.click(m.button('Save'));
    await flush();
    expect(sent.at(-1)).toMatchObject({ connection: 'usb', address: '/dev/usb/lp0', paper_width_mm: 58 });
    expect(errorOf('Address')).toBe('Use /dev/usb/lp0 or /dev/pos-printer-… from the install guide');
    answer = null;
    m.click(m.button('Save'));
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('[03c §6.2] edit keeps the printer_id and fields; 80 mm and LAN preselected', async () => {
    const save = vi.fn<(p: SavePrinterPayload) => Promise<HubError | null>>(async () => null);
    m.render(<PrinterDialog printer={PRINT_CONFIG.printers[0]!} save={save} onClose={() => {}} />);
    expect(m.text()).toContain('Edit Tandoor printer');
    expect(fields().name.value).toBe('Tandoor printer');
    expect(fields().address.value).toBe('192.168.1.50:9100');
    expect(m.button('80 mm').getAttribute('aria-pressed')).toBe('true');
    m.click(m.button('Save'));
    await flush();
    expect(save).toHaveBeenCalledWith({ printer_id: 'P1', name: 'Tandoor printer', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false }, expect.any(String));
  });
  it('[00 M47 03c §6.2] Save again after a network failure reuses the command_id while the payload is unchanged; a changed payload or an api answer gets a new one', async () => {
    const ids: string[] = [];
    const answers: Array<HubError | null> = [
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'api', status: 409, code: 'CONFIG_NAME_TAKEN', details: {} },
      null,
    ];
    const save = vi.fn(async (_p: SavePrinterPayload, commandId: string) => {
      ids.push(commandId);
      return answers.shift() ?? null;
    });
    m.render(<PrinterDialog printer={null} save={save} onClose={() => {}} />);
    type(fields().name, 'Grill printer');
    type(fields().address, '192.168.1.9');
    m.click(m.button('Save'));
    await flush();
    expect(m.text()).toContain('The hub cannot be reached');
    m.click(m.button('Save'));
    await flush();
    expect(ids[1]).toBe(ids[0]);
    type(fields().address, '192.168.1.10');
    m.click(m.button('Save'));
    await flush();
    expect(ids[2]).not.toBe(ids[1]);
    m.click(m.button('Save'));
    await flush();
    expect(ids[3]).toBe(ids[2]);
    // after an api answer (name taken) the next save is a new command
    m.click(m.button('Save'));
    await flush();
    expect(ids[4]).not.toBe(ids[3]);
  });
});
