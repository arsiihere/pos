import { pinPadClient } from '../lib/page.js';

// 00-S03 / 00-S07 (docs/design/handoff/00/00-design.md §1): name tiles + PIN card, shared by /admin/bootstrap,
// /admin/approve and /admin. Needs clientPrelude() and globalStateClient() before it.
// o: { roster, card (elements), load() → Promise<{ status, body }>, login(staffId, pin) → Promise<{ status, body }>,
//      onDone(data), onExpired(), global(error) → true when the page showed a global state (00-F*) }
export function signInClient(): string {
  return `${pinPadClient()}
function adminSignIn(o) {
  let selected = null;
  let tiles = [];
  let busyRetried = false;
  const who = node('strong', 'title', '');
  const head = node('div', 'pos-stack');
  head.appendChild(node('p', 'body', t('pin.for')));
  head.appendChild(who);
  const status = node('div');
  status.name = 'auth_error';
  status.setAttribute('aria-live', 'polite');
  const pad = pinPad(() => submit());
  o.card.replaceChildren(head, status, pad.el);
  const say = (el) => status.replaceChildren(...(el ? [el] : []));
  // A kit field error shows only inside .pos-field--error.
  const line = (text) => {
    const box = node('div', 'pos-field pos-field--error');
    const p = node('p', 'pos-field__error');
    p.appendChild(icon('alert'));
    p.appendChild(node('span', '', text));
    box.appendChild(p);
    return box;
  };
  const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const lockTile = (tile, until, now) => {
    tile.disabled = true;
    tile.setAttribute('aria-disabled', 'true');
    tile.classList.add('is-locked');
    const note = node('small');
    note.appendChild(icon('lock'));
    note.appendChild(document.createTextNode(t('staff.locked_min', { min: minutes(until - now) })));
    tile.replaceChildren(document.createTextNode(tile.staffName), note);
  };
  const select = (member, tile) => {
    selected = member;
    for (const other of tiles) other.setAttribute('aria-pressed', other === tile ? 'true' : 'false');
    who.textContent = member.display_name;
    pad.clear();
    pad.lock(false);
    say(null);
  };
  const skeleton = () => {
    const parts = [];
    for (let i = 0; i < 3; i += 1) {
      const tile = node('div', 'pos-staff__tile');
      tile.appendChild(node('span', 'pos-skeleton'));
      parts.push(tile);
    }
    o.roster.replaceChildren(...parts);
    o.roster.setAttribute('aria-busy', 'true');
    say(node('p', 'caption', t('bootstrap.loading')));
  };
  const render = (staff) => {
    const now = Date.now();
    tiles = [];
    o.roster.replaceChildren();
    o.roster.removeAttribute('aria-busy');
    say(null);
    for (const member of staff) {
      const tile = node('button', 'pos-staff__tile', member.display_name);
      tile.type = 'button';
      tile.staffName = member.display_name;
      tile.member = member;
      tile.setAttribute('aria-pressed', 'false');
      if (member.locked_until !== null && member.locked_until > now) lockTile(tile, member.locked_until, now);
      else tile.addEventListener('click', () => select(member, tile));
      tiles.push(tile);
      o.roster.appendChild(tile);
    }
    if (staff.length === 0) {
      const empty = node('div', 'pos-empty');
      empty.appendChild(node('h3', '', t('bootstrap.no_admins_title')));
      empty.appendChild(node('p', '', t('bootstrap.no_admins')));
      o.card.replaceChildren(empty);
      return;
    }
    // A phone's roster holds only its owner (M38): pre-select.
    const open = tiles.filter((tile) => !tile.disabled);
    if (staff.length === 1 && open.length === 1) select(open[0].member, open[0]);
  };
  const load = async () => {
    skeleton();
    let res;
    try {
      res = await o.load();
    } catch {
      return say(renderGlobalState({ id: 'F01', mode: 'banner' }));
    }
    if (res.status === 200) return render(res.body.data.staff);
    const error = res.body && res.body.error;
    if (error && error.code === 'PAIRING_TOKEN_INVALID') return o.onExpired();
    if (!o.global(error)) say(banner('danger', errorText(error)));
  };
  const submit = async () => {
    if (selected === null) return say(line(t('bootstrap.pick_first')));
    const pin = pad.input.value;
    if (!/^[0-9]{4,6}$/.test(pin)) return say(line(t('pin.length')));
    let res;
    try {
      res = await o.login(selected.staff_id, pin);
    } catch {
      return say(renderGlobalState({ id: 'F01', mode: 'banner' }));
    }
    if (res.status === 200) {
      busyRetried = false;
      return o.onDone(res.body.data);
    }
    const error = (res.body && res.body.error) || { code: 'INTERNAL_ERROR', details: {} };
    const details = error.details || {};
    pad.clear();
    if (error.code === 'PAIRING_TOKEN_INVALID') return o.onExpired();
    if (error.code === 'SERVICE_UNAVAILABLE' && !busyRetried) {
      busyRetried = true;
      pad.input.value = pin;
      setTimeout(submit, Math.min(details.retry_after_ms > 0 ? details.retry_after_ms : 1000, 5000));
      return;
    }
    if (error.code === 'SERVICE_UNAVAILABLE') {
      busyRetried = false;
      return say(renderGlobalState({ id: 'F05', mode: 'banner' }, { retry: () => say(null) }));
    }
    if (error.code === 'PIN_INVALID') {
      pad.error();
      return say(line(details.attempts_remaining <= 2 ? t('pin.tries_left', { n: details.attempts_remaining }) : t('pin.wrong')));
    }
    if (error.code === 'VALIDATION_FAILED') return say(line(t('pin.length')));
    const min = minutes(details.retry_after_ms || 0);
    if (error.code === 'PIN_LOCKED_OUT') {
      const tile = tiles.find((item) => item.member === selected);
      if (tile) lockTile(tile, Date.now() + (details.retry_after_ms || 0), Date.now());
      pad.lock(true);
      return say(banner('danger', t('pin.locked_title'), t('pin.locked_person', { name: selected.display_name, min })));
    }
    if (error.code === 'IP_LOCKED_OUT' || error.code === 'DEVICE_LOCKED_OUT') {
      pad.lock(true);
      setTimeout(() => pad.lock(false), details.retry_after_ms || 0);
      return say(error.code === 'IP_LOCKED_OUT'
        ? banner('danger', t('pin.locked_ip'), t('pin.locked_ip_body', { min }))
        : banner('danger', t('pin.locked_device', { min }), t('pin.locked_device_body')));
    }
    if (error.code === 'PERMISSION_DENIED' || error.code === 'STAFF_NOT_FOUND') {
      say(banner('danger', t('bootstrap.not_admin'), t('bootstrap.not_admin_body')));
      if (error.code === 'STAFF_NOT_FOUND') {
        selected = null;
        who.textContent = '';
        const kept = Array.from(status.children);
        await load();
        status.replaceChildren(...kept);
      }
      return;
    }
    if (!o.global(error)) say(banner('danger', errorText(error)));
  };
  load();
  return { reload: load };
}
`;
}
