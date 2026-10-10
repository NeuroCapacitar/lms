import { execFileSync } from 'node:child_process';

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
  ],
});
