import { test, expect } from '@playwright/test'

// Throwaway QA verification pass for lazy-loaded routes (React.lazy + Suspense +
// manualChunks echarts/react-vendor split). Not a permanent regression test —
// exercises manual navigation through the sidebar against the production
// `vite preview` build already running on :5173, backend mock mode on :8000.

test.describe.configure({ mode: 'serial' })

function attachConsoleCapture(page: import('@playwright/test').Page, bucket: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(`console.error: ${msg.text()}`)
  })
  page.on('pageerror', (err) => bucket.push(`pageerror: ${err.message}`))
  page.on('requestfailed', (req) => {
    bucket.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`)
  })
}

test('Run page loads eagerly, no console errors', async ({ page }) => {
  const errors: string[] = []
  attachConsoleCapture(page, errors)
  await page.goto('/run')
  await expect(page.locator('body')).not.toBeEmpty()
  // Something identifiable from the Run page should render
  await expect(page.getByRole('button', { name: /Start/i })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(1000)
  console.log('ROUTE=/run ERRORS=', JSON.stringify(errors))
  expect(errors, `Run page console errors: ${JSON.stringify(errors)}`).toEqual([])
})

test('Sidebar nav to Recipes, History, Hardware, Settings — each renders, no console errors', async ({ page }) => {
  const errors: string[] = []
  attachConsoleCapture(page, errors)
  await page.goto('/run')
  await page.waitForTimeout(500)

  const routes: { name: RegExp; path: string }[] = [
    { name: /Recipes/i, path: '/recipes' },
    { name: /History/i, path: '/history' },
    { name: /Hardware/i, path: '/hardware' },
    { name: /Settings/i, path: '/settings' },
  ]

  for (const r of routes) {
    const before = errors.length
    const link = page.getByRole('link', { name: r.name }).first()
    if (await link.isVisible().catch(() => false)) {
      await link.click()
    } else {
      await page.goto(r.path)
    }
    await page.waitForURL(new RegExp(r.path.replace('/', '\\/') + '$'), { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(800)
    const bodyText = await page.locator('body').innerText()
    const blank = bodyText.trim().length === 0
    console.log(`ROUTE=${r.path} BLANK=${blank} NEW_ERRORS=`, JSON.stringify(errors.slice(before)), 'BODY_SNIPPET=', JSON.stringify(bodyText.slice(0, 200)))
    expect(blank, `${r.path} rendered blank body`).toBe(false)
  }
  console.log('ALL_NAV_ERRORS=', JSON.stringify(errors))
  expect(errors, `Nav console errors: ${JSON.stringify(errors)}`).toEqual([])
})

test('History -> detail row loads echarts waveform (lazy + split vendor chunk)', async ({ page }) => {
  const errors: string[] = []
  attachConsoleCapture(page, errors)
  await page.goto('/history')
  await page.waitForTimeout(1000)

  const row = page.locator('table tbody tr, [role="row"]').first()
  const hasRow = await row.isVisible().catch(() => false)
  console.log('HISTORY_HAS_ROW=', hasRow)

  if (hasRow) {
    await row.click()
    await page.waitForURL(/\/history\/[^/]+$/, { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const canvasOrSvg = page.locator('canvas, svg').first()
    const chartVisible = await canvasOrSvg.isVisible({ timeout: 8000 }).catch(() => false)
    console.log('HISTORY_DETAIL_URL=', page.url())
    console.log('HISTORY_DETAIL_CHART_VISIBLE=', chartVisible)
    expect(chartVisible, 'echarts waveform canvas/svg did not render on history detail').toBe(true)
  } else {
    console.log('HISTORY_DETAIL_SKIPPED_NO_ROWS')
  }

  // "Compare" is a Button (not a link) that only appears once >=2 rows are checked.
  await page.goto('/history')
  await page.waitForTimeout(1000)
  const rowCheckboxes = page.locator('table tbody tr [data-slot="checkbox"]')
  const checkboxCount = await rowCheckboxes.count()
  console.log('HISTORY_ROW_CHECKBOX_COUNT=', checkboxCount)
  if (checkboxCount >= 2) {
    await rowCheckboxes.nth(0).click()
    await rowCheckboxes.nth(1).click()
    await page.waitForTimeout(300)
    const compareBtn = page.getByRole('button', { name: /Compare/i }).first()
    const hasCompareBtn = await compareBtn.isVisible().catch(() => false)
    console.log('HAS_COMPARE_BTN_AFTER_SELECT=', hasCompareBtn)
    if (hasCompareBtn) {
      await compareBtn.click()
      await page.waitForURL(/\/history\/compare/, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(1200)
      const bodyText = await page.locator('body').innerText()
      console.log('COMPARE_URL=', page.url())
      console.log('COMPARE_BLANK=', bodyText.trim().length === 0)
      expect(bodyText.trim().length).toBeGreaterThan(0)
    }
  } else {
    console.log('COMPARE_SKIPPED_NOT_ENOUGH_ROWS')
  }

  console.log('HISTORY_DETAIL_COMPARE_ERRORS=', JSON.stringify(errors))
  expect(errors, `History/detail/compare console errors: ${JSON.stringify(errors)}`).toEqual([])
})

test('Back to /run once more — repeat navigation does not break', async ({ page }) => {
  const errors: string[] = []
  attachConsoleCapture(page, errors)
  await page.goto('/run')
  await expect(page.getByRole('button', { name: /Start/i })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)
  console.log('FINAL_RUN_REVISIT_ERRORS=', JSON.stringify(errors))
  expect(errors, `Final /run revisit console errors: ${JSON.stringify(errors)}`).toEqual([])
})
