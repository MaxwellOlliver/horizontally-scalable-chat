import { defineConfig, loadEnv } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server proxies the API + WS upgrade to the backend so the client speaks
// same-origin (no CORS) and the WS handshake lands on the gateway. Target
// defaults to the Nginx front door; override with VITE_PROXY_TARGET.
//
// NOTE: Nginx currently routes /auth, /ws, /presence. /social and /chat still
// need upstreams added before the friends/chat screens can reach them.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8080'
  const wsTarget = target.replace(/^http/, 'ws')
  const http = { target, changeOrigin: true }

  return {
    // tanstackRouter must come before the React plugin (it generates the route
    // tree from src/routes/** into src/routeTree.gen.ts).
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    server: {
      port: 5173,
      proxy: {
        '/auth': http,
        '/social': http,
        '/chat': http,
        '/presence': http,
        '/ws': { target: wsTarget, ws: true, changeOrigin: true },
      },
    },
  }
})
