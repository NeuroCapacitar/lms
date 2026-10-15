import { execFileSync } from 'node:child_process';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaKillSwitch } from './src/features/pwa/pwa.ts';

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** SHA do commit; `-dirty` se há mudança local (o deploy recusa). `RELEASE_ID` sobrescreve (CI). */
function releaseId(): string {
  if (process.env.RELEASE_ID) return process.env.RELEASE_ID;
  const sha = git('rev-parse', 'HEAD');
  if (!sha) return 'dev';
  return git('status', '--porcelain') ? `${sha}-dirty` : sha;
}

export default defineConfig({
  define: {
    __RELEASE_ID__: JSON.stringify(releaseId()),
    __APP_ENV__: JSON.stringify(process.env.CLOUDFLARE_ENV || 'dev'),
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: 'src/web/routes',
      generatedRouteTree: 'src/web/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
    cloudflare(),
    // PWA (M8-01): só o shell estático com hash; `prompt` (nunca atualiza sozinho); o app registra o SW à mão.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      // Kill switch: `PWA_KILL=1` no build publica um sw.js que limpa os caches e se desregistra.
      selfDestroying: pwaKillSwitch(process.env),
      manifest: {
        name: 'NeuroCapacitar Hub',
        short_name: 'NeuroCapacitar',
        description: 'Plataforma de cursos da NeuroCapacitar.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0f4c5c',
        theme_color: '#0f4c5c',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Só o shell com hash e os estáticos do aluno; nada de API (o SW nem as conhece).
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
        // A Staff é online-only: nenhum chunk dela entra no cache (nem código nem dado).
        globIgnores: ['**/og-default.png', '**/assets/staff*'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
});
