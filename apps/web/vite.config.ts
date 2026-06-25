import { defineConfig, loadEnv } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies the API + WS upgrade to the backend so the client speaks
// same-origin (no CORS). Everything the backend serves lives under a single
// `/api` prefix that the proxy STRIPS before forwarding — so the SPA owns the
// rest of the path space (notably its own /chat/* router routes) without
// colliding with the chat-service API. Nginx is unchanged: it still sees
// /auth, /chat, /ws at the root. Target defaults to the Nginx front door;
// override with VITE_PROXY_TARGET.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8080'
  const wsTarget = target.replace(/^http/, 'ws')
  const stripApi = (p: string) => p.replace(/^\/api/, '')

  return {
    // tanstackRouter must come before the React plugin (it generates the route
    // tree from src/routes/** into src/routeTree.gen.ts).
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    server: {
      // Bind all interfaces (not just 127.0.0.1) so the dev server is reachable
      // from the Windows host across the WSL2 boundary — loopback-only binds are
      // not reliably forwarded.
      host: true,
      port: 5173,
      proxy: {
        // /api/ws must precede /api so the WebSocket upgrade rule wins the match.
        '/api/ws': { target: wsTarget, ws: true, changeOrigin: true, rewrite: stripApi },
        '/api': { target, changeOrigin: true, rewrite: stripApi },
      },
    },
  }
})
