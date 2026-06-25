import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: [
    {
      command: 'cd ../backend && .venv\\Scripts\\python -m uvicorn app.main:app --port 8000 --host 127.0.0.1',
      url: 'http://127.0.0.1:8000/api/recipes',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
