/**
 * Prepara o build para os e2e do player de vídeo (M5-02): copia a página do provider FALSO para os assets
 * e AFROUXA a CSP só para ela (e o `frame-src` da página do app, só neste build de teste). Roda DEPOIS do
 * `bun run build` e só no comando do Playwright: um build de Staging ou Production nunca passa por aqui, então
 * a página falsa não existe lá e a CSP de `public/_headers` segue estrita.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const client = join(process.cwd(), 'dist', 'client');
const headersPath = join(client, '_headers');
if (!existsSync(headersPath))
  throw new Error('dist/client/_headers não existe: rode o build antes');

copyFileSync(
  join(process.cwd(), 'e2e', 'support', 'fake-video.html'),
  join(client, 'fake-video.html'),
);

let headers = readFileSync(headersPath, 'utf8');
if (!headers.includes('frame-src https://challenges.cloudflare.com')) {
  throw new Error('a CSP mudou: ajuste este script');
}
headers = headers.replace(
  'frame-src https://challenges.cloudflare.com',
  "frame-src 'self' https://challenges.cloudflare.com",
);
// O Worker serve `/fake-video.html` como `/fake-video` (html_handling): a regra vale para os dois caminhos.
const relaxed = `  ! Content-Security-Policy
  ! X-Frame-Options
  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'
  X-Frame-Options: SAMEORIGIN
`;
headers += `
/fake-video
${relaxed}
/fake-video.html
${relaxed}`;
writeFileSync(headersPath, headers);
console.log('build de teste preparado para o provider de vídeo falso');
