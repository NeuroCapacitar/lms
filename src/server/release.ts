/** Identificação da versão publicada: SHA do commit, embutido no build (vite.config.ts). */
export const RELEASE_ID: string = typeof __RELEASE_ID__ === 'string' ? __RELEASE_ID__ : 'dev';
export const APP_ENV: string = typeof __APP_ENV__ === 'string' ? __APP_ENV__ : 'dev';
