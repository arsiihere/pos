import { useRef, useState } from 'react';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Switch } from '../../../components/Switch';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { ConfigPrinter, SetStationOutputPayload, StationOutput } from './api';
import { OPTION_KEY, OUTPUT_OPTIONS, optionOf, outputPayload, type OutputOption } from './output-modes';
import { PaperPreview, type PaperLineSpec } from './PaperPreview';

// 03c §3.2, §6.3; 03c-D04 (frame OutputEditor): 4 options, the printer (required for any paper), the two ticket
// toggles (paper only). Save → SetStationOutput; `400 VALIDATION_FAILED { field: 'printer_id' }` → the printer field.

const HELP_KEY: Record<OutputOption, MessageKey> = {
  screen: 'outputs.mode.screen_help',
  fallback: 'outputs.mode.fallback_help',
  both: 'outputs.mode.both_help',
  printer: 'outputs.mode.printer_help',
};

/**
 * The preview of this station's ticket head (brief §5.2 sample A: the station name, the identifier, the meta line the
 * two toggles change, one line), at the chosen printer's width. The sample order is the brief's; the hub prints the
 * real one (03c §3.3).
 */
export function ticketSample(station: string, columns: number, toggles: { show_taker: boolean; show_order_id: boolean }): PaperLineSpec[] {
  const meta = ['DINE-IN', toggles.show_taker ? 'Hamza' : null, toggles.show_order_id ? '#7F3K2Q' : null].filter((p) => p !== null).join('  ');
  return [
    { text: station.toUpperCase(), bold: true },
    { text: '='.repeat(columns) },
    { text: 'T4', x2: true, bold: true },
    { text: meta },
    { text: '-'.repeat(columns) },
    { text: '2 x Chicken Karahi Full', bold: true },
  ];
}

function printerField(error: HubError): boolean {
  return error.kind === 'api' && error.code === 'VALIDATION_FAILED' && error.details['field'] === 'printer_id';
}

export function OutputEditor({
  output,
  printers,
  save,
  onClose,
}: {
  output: StationOutput;
  /** active printers */
  printers: readonly ConfigPrinter[];
  /** sends SetStationOutput with this command_id; resolves with the refusal, or null when saved */
  save: (payload: SetStationOutputPayload, commandId: string) => Promise<HubError | null>;
  onClose: () => void;
}) {
  const [option, setOption] = useState<OutputOption>(optionOf(output));
  const [printerId, setPrinterId] = useState<string | null>(printers.some((p) => p.printer_id === output.printer_id) ? output.printer_id : null);
  const [showTaker, setShowTaker] = useState(output.show_taker);
  const [showOrderId, setShowOrderId] = useState(output.show_order_id);
  const [needPrinter, setNeedPrinter] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 00 M47: a Save after a network failure resends the same command_id while the payload is unchanged.
  const pending = useRef<{ key: string; id: string } | null>(null);
  const close = () => {
    if (!busy) onClose();
  };
  const name = output.name ?? output.station_id;
  const paper = option !== 'screen';
  const width = printers.find((p) => p.printer_id === printerId)?.paper_width_mm ?? 80;

  const submit = async () => {
    setBanner(null);
    const built = outputPayload(output.station_id, option, printerId, { show_taker: showTaker, show_order_id: showOrderId });
    if (!built.ok) {
      setNeedPrinter(true);
      return;
    }
    setNeedPrinter(false);
    const key = JSON.stringify(built.payload);
    if (pending.current?.key !== key) pending.current = { key, id: newUlid() };
    setBusy(true);
    const refused = await save(built.payload, pending.current.id);
    setBusy(false);
    if (refused?.kind !== 'network') pending.current = null;
    if (refused === null) onClose();
    else if (printerField(refused)) setNeedPrinter(true);
    else setBanner(errorText(refused));
  };

  return (
    <Dialog
      title={fill(t('outputs.editor_title'), { station: name })}
      onClose={close}
      footer={
        <>
          <button type="button" className="pos-btn" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </button>
          <BusyButton primary busy={busy} onClick={() => void submit()}>
            {t('kitchen_screens.save')}
          </BusyButton>
        </>
      }
    >
      {banner !== null && <Banner tone="danger" text={banner} />}
      <div className="modes" role="group" aria-label={t('outputs.title')}>
        {OUTPUT_OPTIONS.map((o) => (
          <button key={o} type="button" className="mode" aria-pressed={o === option} onClick={() => setOption(o)}>
            {t(OPTION_KEY[o])}
            <small>{t(HELP_KEY[o])}</small>
          </button>
        ))}
      </div>
      {paper && (
        <>
          <label className={`pos-field${needPrinter && printerId === null ? ' pos-field--error' : ''}`}>
            <span className="pos-field__label">{t('outputs.printer')}</span>
            <select className="pos-select" value={printerId ?? ''} onChange={(e) => setPrinterId(e.target.value === '' ? null : e.target.value)}>
              <option value="">{t('outputs.pick_printer')}</option>
              {printers.map((p) => (
                <option key={p.printer_id} value={p.printer_id}>
                  {p.name}
                </option>
              ))}
            </select>
            {needPrinter && printerId === null && <span className="pos-field__error">{t('outputs.need_printer')}</span>}
          </label>
          <div className="ad-stack">
            <Switch checked={showTaker} label={t('outputs.show_taker')} onChange={setShowTaker} />
            <Switch checked={showOrderId} label={t('outputs.show_order_id')} onChange={setShowOrderId} />
          </div>
          <div className="paperw">
            <span className="paperw__l">{fill(t('paper.preview'), { width: String(width) })}</span>
            <PaperPreview width={width} lines={ticketSample(name, width === 58 ? 32 : 48, { show_taker: showTaker, show_order_id: showOrderId })} />
          </div>
        </>
      )}
    </Dialog>
  );
}
