import { describe, expect, it, vi } from 'vitest';
import { createContextSlot, takeawayContext } from './context-slot';
import { readOwnShift, shiftEvent } from './own-shift';

// 02b-TK A2 item 1 (frames ShellAnatomy, PersonMenu; MAPPING TK-SH01, TK-SH02; R3): the top bar's context slot and
// the own-shift read behind the shift banner and the person menu's My shift line (05 v1.0.34 §6.16).

describe('[02b-TK TK-SH01] the context slot store', () => {
  it('holds the screen\'s slot until it clears it; listeners hear every change', () => {
    const slot = createContextSlot();
    const heard = vi.fn();
    const off = slot.subscribe(heard);
    expect(slot.get()).toBeNull();
    const v = { label: 'New takeaway', token: null, name: null, sub: 'Token after Send' };
    slot.set(v);
    expect(slot.get()).toBe(v);
    slot.set(null);
    expect(slot.get()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    slot.set(v);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('[02b-TK TK-SH01; R3] takeawayContext', () => {
  const none = { adding: null, token: null, paying: null, cartName: null, seeContact: true };
  it('[frame ShellAnatomy] a new cart: "New takeaway · Usman" / "Token after Send"', () => {
    expect(takeawayContext({ ...none, cartName: 'Usman' })).toEqual({ label: 'New takeaway', token: null, name: 'Usman', sub: 'Token after Send' });
    expect(takeawayContext({ ...none, cartName: '  ' })).toEqual({ label: 'New takeaway', token: null, name: null, sub: 'Token after Send' });
  });

  it('[frames TokenReady, TokenDue] the open token view: "Token 54 · Ali" / Paid or Due', () => {
    expect(takeawayContext({ ...none, cartName: 'Usman', token: { token: 48, name: 'Ali', paid: true } })).toEqual({ label: 'Token', token: '48', name: 'Ali', sub: 'Paid', back: true });
    expect(takeawayContext({ ...none, token: { token: 54, name: null, paid: false } })).toEqual({ label: 'Token', token: '54', name: null, sub: 'Due', back: true });
  });

  it('[frame PayCard] the pay panel: "Token 57 · Usman" / "Take payment"; still sending → New takeaway', () => {
    expect(takeawayContext({ ...none, paying: { ident: '57', name: 'Usman' } })).toEqual({ label: 'Token', token: '57', name: 'Usman', sub: 'Take payment' });
    expect(takeawayContext({ ...none, paying: { ident: null, name: 'Usman' } })).toEqual({ label: 'New takeaway', token: null, name: 'Usman', sub: 'Take payment' });
  });

  it('[frame TokenAddItems] adding to a sent token: "Token 53 · Bilal" / "Adding to token"', () => {
    expect(takeawayContext({ ...none, adding: { token: 53 }, cartName: 'Bilal' })).toEqual({ label: 'Token', token: '53', name: 'Bilal', sub: 'Adding to token' });
  });

  it('[R3] the name only for view-customer-contact holders: anyone else sees no name at all', () => {
    const hidden = { ...none, seeContact: false };
    expect(takeawayContext({ ...hidden, cartName: 'Usman' }).name).toBeNull();
    expect(takeawayContext({ ...hidden, token: { token: 48, name: 'Ali', paid: true } }).name).toBeNull();
    expect(takeawayContext({ ...hidden, paying: { ident: '57', name: 'Usman' } }).name).toBeNull();
  });
});

describe('[05 §6.16] readOwnShift', () => {
  const ok = (data: unknown) => async () => ({ ok: true as const, data });
  it('an open shift → open (opened_at, float); 404 SHIFT_NOT_FOUND or a closed one → none; anything else → unknown', async () => {
    expect(await readOwnShift(ok({ shift_id: 'SH1', state: 'open', opened_at: 7, float_minor: 500_000 }))).toEqual({ kind: 'open', opened_at: 7, float_minor: 500_000 });
    expect(await readOwnShift(ok({ shift_id: 'SH1', state: 'closed', opened_at: 7, float_minor: 0 }))).toEqual({ kind: 'none' });
    expect(await readOwnShift(async () => ({ ok: false as const, error: { kind: 'api' as const, status: 404, code: 'SHIFT_NOT_FOUND', details: {} } }))).toEqual({ kind: 'none' });
    expect(await readOwnShift(async () => ({ ok: false as const, error: { kind: 'api' as const, status: 403, code: 'PERMISSION_DENIED', details: {} } }))).toEqual({ kind: 'unknown' });
    expect(await readOwnShift(async () => ({ ok: false as const, error: { kind: 'network' as const } }))).toEqual({ kind: 'unknown' });
  });

  it('a shift event on the socket means: read again', () => {
    expect(['ShiftOpened', 'ShiftClosed', 'ShiftCounted', 'ShiftCountSkipped'].every(shiftEvent)).toBe(true);
    expect(shiftEvent('OrderPlaced')).toBe(false);
  });
});
