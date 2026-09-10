import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Guard rail: fail the build if any VITE_-prefixed env var looks like a secret.
// Anything prefixed VITE_ is bundled into the client JS and is public by design
// (see .env.example and CLAUDE.md invariant 7). A service key or DB URL must
// never carry that prefix.
function assertNoLeakedSecrets(env: Record<string, string>) {
  const offenders = Object.keys(env).filter(
    (key) => key.startsWith('VITE_') && /SERVICE_ROLE|DB_URL|SECRET/i.test(key)
  )
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to build: secret-shaped env var(s) with a VITE_ prefix would be ` +
        `bundled into the browser: ${offenders.join(', ')}`
    )
  }
}
assertNoLeakedSecrets(process.env as Record<string, string>)

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Rewind Ops',
        short_name: 'Rewind',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [],
      },
    }),
  ],
})
