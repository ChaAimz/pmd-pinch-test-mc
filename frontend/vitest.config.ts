import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Unit tests only — e2e specs under tests/e2e are run by Playwright (`npx playwright test`),
  // not vitest (they call test.describe from @playwright/test, which throws under vitest).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
