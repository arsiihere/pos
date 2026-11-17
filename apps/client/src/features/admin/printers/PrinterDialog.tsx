import { useRef, useState, type ReactNode } from 'react';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Segmented } from '../../../components/Segmented';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { ConfigPrinter, SavePrinterPayload } from './api';

// 03c §3.2, §6.2; 03c-D01 (frame PrinterAdd): add / edit a printer. The checks mirror SavePrinter's
// (apps/hub/src/print/commands/printer.ts), so a typing slip is shown on its field before anything is sent; the hub's
// answer still decides: CONFIG_NAME_TAKEN → the Name field, a VALIDATION_FAILED issue → its field.

export const NAME_MAX = 40;
const USB_PATH = /^(?:\/dev\/usb\/lp[0-9]|\/dev\/pos-printer-[a-z0-9-]{1,30})$/;

/** §3.2: a private IPv4 (10/8, 172.16/12, 192.168/16) with an optional port 1–65535 (default 9100). */
export function lanAddressOk(address: string): boolean {
  const match = /^([0-9.]+)(?::([0-9]{1,5}))?$/.exec(address);
  if (match === null) return false;
  const parts = match[1]!.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^(?:0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number) as [number, number];
  if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return false;
  if (match[2] === undefined) return true;
  const port = Number(match[2]);
  return port >= 1 && port <= 65_535 && match[2] === String(port);
}

export function usbPathOk(address: string): boolean {
  return USB_PATH.test(address);
}

type Field = 'name' | 'address';
type Errors = Partial<Record<Field, MessageKey>>;

function issueFields(error: HubError): Field[] {
  if (error.kind !== 'api') return [];
  const issues = error.details['issues'];
  const paths = Array.isArray(issues) ? issues.map((i) => String((i as { path?: unknown }).path ?? '')) : [];
  const field = error.details['field'];
  if (typeof field === 'string') paths.push(field);
  return (['name', 'address'] as const).filter((f) => paths.some((p) => p === f || p.startsWith(`${f}.`)));
}

function FieldBox({ label, error, help, children }: { label: string; error?: string | undefined; help?: string; children: ReactNode }) {
  return (
    <label className={`pos-field${error !== undefined ? ' pos-field--error' : ''}`}>
      <span className="pos-field__label">{label}</span>
      {children}
      {error !== undefined ? <span className="pos-field__error">{error}</span> : help !== undefined && <span className="pos-field__help">{help}</span>}
    </label>
  );
}

export function PrinterDialog({
  printer,
  save,
  onClose,
}: {
  /** null = a new printer */
  printer: ConfigPrinter | null;
  /** sends SavePrinter with this command_id; resolves with the refusal, or null when saved */
  save: (payload: SavePrinterPayload, commandId: string) => Promise<HubError | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(printer?.name ?? '');
  const [connection, setConnection] = useState<'lan' | 'usb'>(printer?.connection ?? 'lan');
  const [address, setAddress] = useState(printer?.address ?? '');
  const [paper, setPaper] = useState<58 | 80>(printer?.paper_width_mm ?? 80);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 00 M47: a Save after a network failure resends the same command_id while the payload is unchanged, so a lost
  // answer to an Add never makes a second printer; a changed payload or any hub answer starts a new command.
  const pending = useRef<{ key: string; id: string } | null>(null);
  const addressError: MessageKey = connection === 'lan' ? 'printers.address_error_lan' : 'printers.address_error_usb';

  const submit = async () => {
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed === '') next.name = 'printers.name_required';
    else if ([...trimmed].length > NAME_MAX) next.name = 'printers.name_help';
    if (!(connection === 'lan' ? lanAddressOk(address.trim()) : usbPathOk(address.trim()))) next.address = addressError;
    setErrors(next);
    setBanner(null);
    if (Object.keys(next).length > 0) return;
    const payload: SavePrinterPayload = {
      ...(printer === null ? {} : { printer_id: printer.printer_id }),
      name: trimmed,
      connection,
      address: address.trim(),
      paper_width_mm: paper,
      archived: false,
    };
    const key = JSON.stringify(payload);
    if (pending.current?.key !== key) pending.current = { key, id: newUlid() };
    setBusy(true);
    const refused = await save(payload, pending.current.id);
    setBusy(false);
    if (refused?.kind !== 'network') pending.current = null;
    if (refused === null) {
      onClose();
      return;
    }
    if (refused.kind === 'api' && refused.code === 'CONFIG_NAME_TAKEN') {
      setErrors({ name: 'printers.name_taken' });
      return;
    }
    const fields = issueFields(refused);
    if (fields.length > 0) {
      setErrors(Object.fromEntries(fields.map((f) => [f, f === 'name' ? 'printers.name_help' : addressError])) as Errors);
      return;
    }
    setBanner(errorText(refused));
  };

  return (
    <Dialog
      title={printer === null ? t('printers.add') : fill(t('printers.edit_title'), { name: printer.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <BusyButton primary busy={busy} onClick={() => void submit()}>
            {t('kitchen_screens.save')}
          </BusyButton>
        </>
      }
    >
      {banner !== null && <Banner tone="danger" text={banner} />}
      <FieldBox label={t('printers.name')} error={errors.name === undefined ? undefined : t(errors.name)} help={t('printers.name_help')}>
        <input className="pos-input" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </FieldBox>
      <div className="pos-field">
        <span className="pos-field__label">{t('printers.connection')}</span>
        <Segmented
          label={t('printers.connection')}
          options={[
            { value: 'lan', label: t('printers.lan') },
            { value: 'usb', label: t('printers.usb') },
          ]}
          value={connection}
          onChange={(v) => {
            setConnection(v);
            setErrors((e) => ({ ...e, address: undefined }));
          }}
        />
      </div>
      <FieldBox
        label={t('printers.address')}
        error={errors.address === undefined ? undefined : t(errors.address)}
        help={t(connection === 'lan' ? 'printers.address_help_lan' : 'printers.address_help_usb')}
      >
        <input className="pos-input pos-input--mono" dir="ltr" value={address} onChange={(e) => setAddress(e.target.value)} />
      </FieldBox>
      <div className="pos-field">
        <span className="pos-field__label">{t('printers.paper')}</span>
        <Segmented
          label={t('printers.paper')}
          options={[
            { value: '58', label: fill(t('printers.paper_mm'), { n: '58' }) },
            { value: '80', label: fill(t('printers.paper_mm'), { n: '80' }) },
          ]}
          value={String(paper) as '58' | '80'}
          onChange={(v) => setPaper(v === '58' ? 58 : 80)}
        />
      </div>
    </Dialog>
  );
}
