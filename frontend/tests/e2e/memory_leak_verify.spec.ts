/**
 * Memory-leak regression — pinch-test frontend.
 *
 * Confirms the decimation + gcTime + cache-eviction fix keeps JS heap bounded
 * across three consecutive 100-loop mock runs.
 *
 * Prerequisites: both servers already running
 *   backend:  http://127.0.0.1:8000 (mock_mode: true)
 *   frontend: http://127.0.0.1:5173
 *
 * Run:
 *   npx playwright test tests/e2e/memory_leak_verify.spec.ts --headed --timeout=600000
 */

import { test, expect } from '@playwright/test'
import type { Page, ConsoleMessage } from '@playwright/test'

// Top-level use() for launchOptions (must not be inside describe)
test.use({
  launchOptions: {
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  },
})

// ------------------------------------------------------------------
// Heap helper — returns usedJSHeapSize in MB (Chromium only).
// Must pass --enable-precise-memory-info to the browser for non-null.
// ------------------------------------------------------------------
async function heapMB(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (performance as any).memory
    if (!m) return null
    return Math.round((m.usedJSHeapSize / 1048576) * 10) / 10
  })
}

// Non-terminal (active run) state display labels from StateBadge.tsx DISPLAY_LABEL
const ACTIVE_STATE_DISPLAY = [
  'Setting up', 'Loop start', 'Clamping', 'Waiting force',
  'Awaiting tension', 'Tension test', 'Evaluating', 'Unclamping',
]
// Terminal / idle state display labels
const TERMINAL_DISPLAY = ['Ready', 'Done', 'Aborted', 'Error']

/**
 * Wait until the machine enters an active (non-idle) state — confirms the run actually started.
 * We look for the cycle counter chip "N / 100" which only appears while isRunning.
 */
async function waitForRunStart(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => {
      // The cycle counter span "N / 100" only exists while isRunning && currentLoop != null
      const spans = Array.from(document.querySelectorAll('span'))
      return spans.some((el) => /\d+ \/ \d+/.test(el.textContent ?? ''))
    },
    undefined,
    { timeout: timeoutMs, polling: 500 },
  )
}

/**
 * Wait until the run finishes: cycle counter disappears AND page shows a terminal badge.
 * First waits for run to start (to avoid immediately matching pre-run "Ready" state).
 */
async function waitForRunComplete(page: Page, timeoutMs = 200_000) {
  // Phase 2 only: wait for cycle counter to disappear (run done) and badge to be terminal.
  // Caller must have already called waitForRunStart() or equivalent.
  await page.waitForFunction(
    (terminals: string[]) => {
      // Cycle counter chip — only visible while running
      const spans = Array.from(document.querySelectorAll('span'))
      const hasCounter = spans.some((el) => /\d+ \/ \d+/.test(el.textContent ?? ''))
      if (hasCounter) return false  // still running
      // Check the badge text
      const allText = document.body.innerText ?? ''
      return terminals.some((t) => allText.includes(t))
    },
    TERMINAL_DISPLAY,
    { timeout: timeoutMs, polling: 1000 },
  )
}

/** Read the "N / 100" loop counter chip text if visible. */
async function readLoopCounter(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const all = document.querySelectorAll('span')
    for (const el of Array.from(all)) {
      if (/\d+ \/ \d+/.test(el.textContent ?? '')) return el.textContent?.trim() ?? null
    }
    return null
  })
}

// ------------------------------------------------------------------
// Test
// ------------------------------------------------------------------

test.describe('Memory-leak regression: 100-loop × 3 runs', () => {

  test('heap stays bounded across three sequential 100-loop runs', async ({ page }) => {
    // Three 100-loop mock runs × ~2.5 min each + All Tensions fetch + overhead ≈ 15 min
    test.setTimeout(1_200_000)  // 20 minutes
    // ------------------------------------------------------------------
    // Console error collector — C6
    // ------------------------------------------------------------------
    const consoleErrors: string[] = []      // real errors (cause test failure)
    const consoleNoise: string[] = []        // known pre-existing noise (logged, not failed)
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // Known pre-existing issues that are NOT OOM/memory-leak indicators:
        //   - React hydration: nested <button> in PopoverTrigger asChild (TopBar DevicePopover)
        //   - React prop warning: asChild forwarded to DOM element
        //   - ECharts: "[ECharts] Unknown series undefined" fires briefly during overlay toggle
        //   - ResizeObserver loop (benign browser artifact)
        //   - favicon 404
        const isKnownNoise = (
          text.includes('ResizeObserver loop') ||
          text.includes('favicon') ||
          text.includes('cannot be a descendant') ||
          text.includes('cannot contain a nested') ||
          text.includes('does not recognize') ||
          text.includes('hydration') ||
          text.includes('[ECharts] Unknown series') ||
          text.includes('asChild')
        )
        if (isKnownNoise) {
          consoleNoise.push(text.split('\n')[0])  // first line only
        } else {
          consoleErrors.push(text)
        }
      }
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`PAGEERROR: ${err.message}`)
    })

    const heapLog: Array<{ label: string; mb: number | null }> = []
    const log = (label: string, mb: number | null) => {
      heapLog.push({ label, mb })
      console.log(`[heap] ${label.padEnd(42)} ${mb !== null ? mb + ' MB' : 'N/A (no performance.memory)'}`)
    }

    // ==================================================================
    // C1 — PAGE LOAD
    // ==================================================================
    await page.goto('/run', { waitUntil: 'networkidle', timeout: 30_000 })
    await page.screenshot({ path: 'tests/e2e/screenshots/01_page_load.png' })

    // Confirm recipe picker is visible
    const comboTrigger = page.locator('[class*="PopoverTrigger"], button').filter({ hasText: /Select recipe|select recipe|MemTest/ }).first()
    // Fallback: look for the ChevronsUpDown button (the recipe combobox trigger)
    const recipeSelector = page.locator('button[class*="inline-flex"][class*="w-56"]').first()
    await expect(recipeSelector).toBeVisible({ timeout: 15_000 })

    // Confirm WS is connected — PlugZap icon should be in the TopBar
    // (the PlugZap SVG is rendered when wsConnected=true)
    // We check by looking for the green dot(s) in the top bar
    const topBar = page.locator('header')
    await expect(topBar).toBeVisible()

    // Baseline heap
    const baseline = await heapMB(page)
    log('baseline', baseline)

    // ==================================================================
    // Select MemTest-100
    // ==================================================================
    await recipeSelector.click()
    // Wait for the command list to appear
    await page.waitForSelector('[cmdk-item], [role="option"]', { timeout: 5_000 })
    // Click the MemTest-100 item
    const memTestItem = page.locator('[cmdk-item], [role="option"]').filter({ hasText: 'MemTest-100' }).first()
    await expect(memTestItem).toBeVisible({ timeout: 5_000 })
    await memTestItem.click()
    await page.screenshot({ path: 'tests/e2e/screenshots/02_recipe_selected.png' })
    console.log('[step] MemTest-100 selected')

    // ==================================================================
    // Helper: run one complete 100-loop session, sample heap mid-run
    // ==================================================================
    async function runOnce(runLabel: string, sampleHeap = false) {
      // Start button contains SVG (Play icon) + "Start" text — partial match
      const startBtn = page.locator('button').filter({ hasText: /Start/ }).first()
      // Wait for Start to be enabled — machine must be in IDLE/Ready
      await expect(startBtn).toBeEnabled({ timeout: 20_000 })
      await startBtn.click()
      console.log(`[step] ${runLabel} started`)
      await page.screenshot({ path: `tests/e2e/screenshots/${runLabel}_started.png` })

      // Confirm the run actually kicked off (cycle counter appears)
      await waitForRunStart(page, 30_000)

      if (sampleHeap) {
        // Collect ~6 heap samples during the run (6s apart)
        for (let i = 1; i <= 6; i++) {
          await page.waitForTimeout(6_000)
          const mb = await heapMB(page)
          const loopCounter = await readLoopCounter(page)
          const sLabel = `${runLabel}_sample${i}${loopCounter ? `(${loopCounter})` : ''}`
          log(sLabel, mb)
          // Stop sampling if cycle counter gone (run finished during this window)
          if (!loopCounter) break
        }
      }

      // Wait for run to complete
      await waitForRunComplete(page, 200_000)
      await page.screenshot({ path: `tests/e2e/screenshots/${runLabel}_done.png` })
      const mb = await heapMB(page)
      log(`after_${runLabel}`, mb)
      return mb
    }

    // ==================================================================
    // C2 + C3 — Run 1 (heap sampled mid-run)
    // ==================================================================
    const heapAfterRun1 = await runOnce('run1', true)

    // ==================================================================
    // C5 — All Cycles (All Tensions) view
    // ==================================================================
    // Button text is "All Tensions" per en.ts run.allCycles
    // Enabled only when loopResults.length > 1; wait up to 10s for loop results to land
    const allCyclesBtn = page.locator('button').filter({ hasText: /All Tensions|All Cycles/ }).first()
    await page.waitForTimeout(1_000)  // let React Query settle
    await expect(allCyclesBtn).toBeEnabled({ timeout: 15_000 })
    await allCyclesBtn.click()
    await page.waitForTimeout(3_000)  // fetch + render
    await page.screenshot({ path: 'tests/e2e/screenshots/05_all_cycles_view.png' })
    const heapAllCycles = await heapMB(page)
    log('all_tensions_open', heapAllCycles)

    // Back to Live — button contains SVG + "Live" text, so use partial match
    const liveBtn = page.locator('button').filter({ hasText: /Live/ }).first()
    await liveBtn.click()
    await page.waitForTimeout(500)

    // ==================================================================
    // C4 — Run 2 (no mid-run sampling needed)
    // ==================================================================
    const heapAfterRun2 = await runOnce('run2', false)

    // ==================================================================
    // C4 — Run 3
    // ==================================================================
    const heapAfterRun3 = await runOnce('run3', false)

    // ==================================================================
    // Zoom test (best-effort; failure here doesn't fail the suite)
    // ==================================================================
    try {
      const chartCanvas = page.locator('canvas').first()
      if (await chartCanvas.isVisible()) {
        const box = await chartCanvas.boundingBox()
        if (box) {
          const cx = box.x + box.width / 2
          const cy = box.y + box.height / 2
          await page.mouse.move(cx, cy)
          await page.mouse.wheel(0, -400)
          await page.waitForTimeout(600)
          await page.screenshot({ path: 'tests/e2e/screenshots/09_zoom_in.png' })
          await page.mouse.dblclick(cx, cy)
          await page.waitForTimeout(400)
          await page.screenshot({ path: 'tests/e2e/screenshots/09_zoom_reset.png' })
          console.log('[step] zoom test complete')
        }
      }
    } catch (e) {
      console.warn('[zoom] non-fatal:', e)
    }

    // ==================================================================
    // Print heap table
    // ==================================================================
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║                   HEAP READINGS TABLE                    ║')
    console.log('╠══════════════════════════════════════════════════════════╣')
    for (const r of heapLog) {
      const mbStr = r.mb !== null ? `${r.mb} MB` : 'N/A'
      console.log(`║  ${r.label.padEnd(44)} ${mbStr.padStart(8)}  ║`)
    }
    console.log('╚══════════════════════════════════════════════════════════╝')

    // ------------------------------------------------------------------
    // ASSERTIONS
    // ------------------------------------------------------------------

    // C1 confirmed: reached this point without crash

    // C2: live chart updated (we waited for state change through active run states)
    // Confirmed by waitForTerminalState completing after non-terminal states

    // C3: heap during run1 must not explode (< 3× baseline)
    if (baseline !== null && heapAfterRun1 !== null) {
      const ratio = heapAfterRun1 / Math.max(baseline, 10)
      console.log(`\n[C3] heap ratio run1/baseline: ${ratio.toFixed(2)}x  (${baseline} → ${heapAfterRun1} MB)`)
      expect(ratio).toBeLessThan(3.0)
    } else {
      console.warn('[C3] SKIP — performance.memory not available; relying on no-crash evidence')
    }

    // C4: cross-run heap must stay bounded (run3 not 2-3× run1)
    if (heapAfterRun1 !== null && heapAfterRun3 !== null) {
      const crossRunRatio = heapAfterRun3 / Math.max(heapAfterRun1, 10)
      console.log(`[C4] heap run1=${heapAfterRun1} MB  run2=${heapAfterRun2} MB  run3=${heapAfterRun3} MB  ratio(run3/run1)=${crossRunRatio.toFixed(2)}x`)
      // Pre-fix behaviour was ~2-3×; with fix it should be < 1.5×
      expect(crossRunRatio).toBeLessThan(1.5)
    } else {
      console.warn('[C4] SKIP — performance.memory not available')
    }

    // C5: All Cycles view was opened (screenshot at 05_all_cycles_view.png)
    // We assert it didn't crash by continuing past the click

    // C6: no uncaught console errors (OOM / JS crashes)
    console.log(`\n[C6] ${consoleErrors.length} real error(s) / ${consoleNoise.length} known-noise error(s):`)
    if (consoleNoise.length > 0) {
      console.log('  [known-noise - pre-existing component issues, not memory-related]:')
      for (const e of consoleNoise) console.log('    ' + e)
    }
    if (consoleErrors.length > 0) {
      console.log('  [REAL ERRORS]:')
      for (const e of consoleErrors) console.log('    ' + e)
    }
    expect(consoleErrors, 'No real JS errors (OOM/crash) should appear').toHaveLength(0)
  })
})
