import QRCode from 'qrcode';

interface QrModules {
  size: number;
  get(row: number, col: number): number;
}

export function qrSvg(text: string): string {
  const created = (QRCode as { create(text: string, options: { errorCorrectionLevel: 'M' }): { modules: QrModules } }).create(
    text,
    { errorCorrectionLevel: 'M' },
  );
  const size = created.modules.size;
  const quiet = 4;
  const dim = size + quiet * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (created.modules.get(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><path fill="#000000" d="${path}"/></svg>`;
}
