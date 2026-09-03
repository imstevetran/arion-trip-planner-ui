import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Keep supporting the old VITE_ name so existing .env.local files work,
  // but prefer the server-only name because this value must not be bundled.
  const selfHostedOrsUrl = (env.SELF_HOSTED_ORS_DIRECTIONS_URL || 'https://ors.theaiinc.com/ors').replace(/\/$/, '')
  const selfHostedOrsApiKey = env.SELF_HOSTED_ORS_API_KEY || env.VITE_OPENROUTESERVICE_API_KEY

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/ors': {
          target: selfHostedOrsUrl,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/ors/, ''),
          headers: selfHostedOrsApiKey ? { Authorization: `Bearer ${selfHostedOrsApiKey}` } : undefined,
        },
      },
    },
  }
})
