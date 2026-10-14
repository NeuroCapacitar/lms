import qrcode from 'qrcode-generator';

/** Margem (quiet zone) em módulos: 4 é o mínimo da norma. */
const QUIET_ZONE = 4;

/**
 * QR gerado LOCALMENTE como SVG (M7-02): nenhuma chamada de rede, nenhum serviço externo, nenhum `<img>`. O SVG
 * é montado aqui (um só `<path>`, sem texto do usuário), então não há o que escapar: só números. Nível de correção
 * M e modo byte; o tamanho da versão é o menor que comporta o texto. O resultado é determinístico.
 */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code de validação"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
