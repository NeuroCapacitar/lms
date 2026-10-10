module.exports = {
  forbidden: [
    {
      name: 'features-nao-importam-framework',
      severity: 'error',
      from: { path: '^src/features' },
      to: { path: '^node_modules/(hono|react|react-dom)/' },
    },
    {
      name: 'features-nao-importam-server-nem-web',
      severity: 'error',
      from: { path: '^src/features' },
      to: { path: '^src/(server|web)/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.worker.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
