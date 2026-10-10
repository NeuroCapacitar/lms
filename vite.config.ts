import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: 'src/web/routes',
      generatedRouteTree: 'src/web/routeTree.gen.ts',
    }),
    react(),
    cloudflare(),
  ],
});
