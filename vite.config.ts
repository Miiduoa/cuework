import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/cuework/' : '/',
  define: { __BROWSER_MODE__: JSON.stringify(mode === 'pages' || mode === 'development') },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy:
      mode === 'workspace'
        ? {
            '/api': {
              target: 'http://127.0.0.1:4173',
              changeOrigin: true,
              configure(proxy) {
                proxy.on('proxyReq', (outgoing, incoming) => {
                  if (incoming.headers.origin === `http://${incoming.headers.host}`)
                    outgoing.setHeader('Origin', 'http://127.0.0.1:4173');
                });
              },
            },
          }
        : undefined,
  },
}));
