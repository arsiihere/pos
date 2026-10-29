// qrcode@1.5.4 ships JavaScript only. Declares only what the hub uses (src/lib/qr.ts,
// src/setup/issue-admin-bootstrap.ts and src/lib/qr.test.ts).
declare module 'qrcode' {
  interface QrModules {
    size: number;
    get(row: number, col: number): number;
  }
  export function create(text: string, options: { errorCorrectionLevel: 'M' }): { modules: QrModules };
  export function toString(text: string, options: { type: 'terminal'; small: boolean }): Promise<string>;
  const QRCode: { create: typeof create; toString: typeof toString };
  export default QRCode;
}
