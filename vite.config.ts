import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// Used to proxy /ors/* straight to the self-hosted ORS instance here (dev
// only — the deployed static site had nothing listening on that path,
// which 405'd every request in production). Both dev and prod now go
// through trip-planner-api's /routing/preview + /routing/status
// (routes/routing.ts) instead — see lib/openRouteService.ts — so the ORS
// key never needs to reach this repo's env at all, dev or prod.
export default defineConfig({
  plugins: [react()],
})
