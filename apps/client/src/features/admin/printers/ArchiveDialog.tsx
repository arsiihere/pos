import { useRef, useState } from 'react';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { ConfigPrinter } from './api';

// 03c §3.2, §6.2; 03c-D02 (frame PrinterArchive): archive = SavePrinter { …the printer, archived: true }. Refused
// 409 CONFIG_IN_USE while an active station's output uses it (Q-18: an archived station already released it): the
// dialog names those stations (`used_by.ids`) and offers "Go to Station outputs".

/** "Tandoor", "Tandoor and Fryer", "Tandoor, Fryer and Cold". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('common.and')} ${names.at(-1)!}`;
}

function inUseIds(error: HubError): string[] | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const ids = (error.details['used_by'] as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? ids.map(String) : [];
}

export function ArchiveDialog({
  printer,
  stationName,
  archive,
  onClose,
  onGoOutputs,
}: {
  printer: ConfigPrinter;
  stationName: (stationId: string) => string;
  /** sends the archive with this command_id; resolves with the refusal, or null when archived */
  archive: (commandId: string) => Promise<HubError | null>;
  onClose: () => void;
  onGoOutputs: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState<string[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // 00 M47: a retry after a network failure resends the same command_id.
  const commandId = useRef<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setBanner(null);
    commandId.current ??= newUlid();
    const refused = await archive(commandId.current);
    setBusy(false);
    if (refused?.kind !== 'network') commandId.current = null;
    if (refused === null) {
      onClose();
      return;
    }
    const ids = inUseIds(refused);
    if (ids !== null) setInUse(ids);
    else setBanner(errorText(refused));
  };

  return (
    <Dialog
      title={fill(t('printers.archive_confirm'), { name: printer.name })}
      onClose={onClose}
      form={false}
      footer={
        inUse === null ? (
          <>
            <button type="button" className="pos-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <BusyButton danger busy={busy} onClick={() => void confirm()}>
              {t('printers.archive')}
            </BusyButton>
          </>
        ) : (
          <>
            <button type="button" className="pos-btn" onClick={onClose}>
              {t('common.close')}
            </button>
            <button type="button" className="pos-btn pos-btn--primary" onClick={onGoOutputs}>
              {t('printers.go_outputs')}
            </button>
          </>
        )
      }
    >
      {inUse !== null && <Banner tone="danger" text={fill(t('printers.in_use'), { stations: joinNames(inUse.map(stationName)) })} />}
      {banner !== null && <Banner tone="danger" text={banner} />}
    </Dialog>
  );
}
