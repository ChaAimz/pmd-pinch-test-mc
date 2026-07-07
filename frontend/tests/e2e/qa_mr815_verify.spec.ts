import { test, expect } from '@playwright/test'

// QA verification pass for MR815 "Imada Tension Limit Reached" feature.
// This is a throwaway manual-verification script, not a permanent regression test —
// removed after the verification pass. Points at the real dev server on :5174
// (the app's own vite dev instance) — port 5173 in this environment is a stale
// `vite preview` static-build server, NOT the live dev server.

const BASE = 'http://127.0.0.1:5174'

test.describe.configure({ mode: 'serial' })

test('Hardware page — Imada Tension Limit card renders with defaults', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  await page.goto(`${BASE}/hardware`)
  await expect(page.getByText('IMADA TENSION LIMIT', { exact: false })).toBeVisible({ timeout: 10000 })

  const limitInput = page.locator('input[placeholder="(N)"]')
  await expect(limitInput).toBeVisible()
  const initialVal = await limitInput.inputValue()
  console.log('DEFAULT_LIMIT_VALUE:', initialVal)
  expect(initialVal).toBe('2.00')

  await page.screenshot({ path: 'test-results/qa_hw_before.png', fullPage: true })
  console.log('CONSOLE_ERRORS_SNAPSHOT_1:', JSON.stringify(consoleErrors))
})

// NumpadInput is a readOnly kiosk-style input — clicking it opens a popover numpad.
// Type a numeric string by tapping digit/decimal keys, then commit with OK.
async function enterNumpadValue(page: import('@playwright/test').Page, input: import('@playwright/test').Locator, text: string) {
  await input.click()
  const popover = page.locator('[data-slot="popover-content"], [role="dialog"]').last()
  // Clear existing draft first
  await page.getByRole('button', { name: 'C', exact: true }).click()
  for (const ch of text) {
    if (ch === '.') {
      await page.getByRole('button', { name: '.', exact: true }).click()
    } else if (ch === '-') {
      await page.getByRole('button', { name: '±', exact: true }).click()
    } else {
      await page.getByRole('button', { name: ch, exact: true }).click()
    }
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click()
}

test('Hardware page — change limit, Set, refetch persists, Clear works', async ({ page }) => {
  await page.goto(`${BASE}/hardware`)
  await expect(page.getByText('IMADA TENSION LIMIT', { exact: false })).toBeVisible({ timeout: 10000 })

  const limitInput = page.locator('input[placeholder="(N)"]')
  await expect(limitInput).toBeVisible()

  // Change value to 3.5 via the on-screen numpad (input is readOnly by design — kiosk UX)
  await enterNumpadValue(page, limitInput, '3.5')
  const valAfterNumpad = await limitInput.inputValue()
  console.log('VALUE_AFTER_NUMPAD_ENTRY:', valAfterNumpad)

  const setBtn = page.getByRole('button', { name: 'Set', exact: true }).last()
  await setBtn.click()
  const toastSeen = await page.getByText('updated', { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false)
  console.log('SET_TOAST_SEEN:', toastSeen)

  // Reload the page to force a full refetch and confirm persistence
  await page.reload()
  await expect(page.getByText('IMADA TENSION LIMIT', { exact: false })).toBeVisible({ timeout: 10000 })
  const limitInput2 = page.locator('input[placeholder="(N)"]')
  await page.waitForTimeout(1500)
  const persisted = await limitInput2.inputValue()
  console.log('PERSISTED_LIMIT_VALUE_AFTER_RELOAD:', persisted)
  expect(persisted).toBe('3.50')

  // Now Clear it
  const clearBtn = page.getByRole('button', { name: 'Clear', exact: true }).last()
  await clearBtn.click()
  await page.waitForTimeout(1000)
  const afterClearVal = await limitInput2.inputValue()
  console.log('VALUE_AFTER_CLEAR_CLICK:', afterClearVal)

  // Set it back to 2 for the next check (usable state, not null/disabled)
  await enterNumpadValue(page, limitInput2, '2')
  await page.getByRole('button', { name: 'Set', exact: true }).last().click()
  await page.waitForTimeout(1000)
  await page.reload()
  await expect(page.getByText('IMADA TENSION LIMIT', { exact: false })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(1000)
  const finalVal = await page.locator('input[placeholder="(N)"]').inputValue()
  console.log('FINAL_LIMIT_VALUE:', finalVal)
  expect(finalVal).toBe('2.00')
  await page.screenshot({ path: 'test-results/qa_hw_after_setclear.png', fullPage: true })
})

test('Run page — start a run, alarm dialog appears, run continues, ack clears', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  await page.goto(`${BASE}/run`)
  await expect(page.getByRole('button', { name: /Start/i })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(1500) // let WS connect + hydrate machineReady/plcBits

  // Select first protocol from the combo (placeholder text: "Select protocol…")
  const comboTrigger = page.getByText('Select protocol', { exact: false }).first()
  if (await comboTrigger.isVisible().catch(() => false)) {
    await comboTrigger.click()
    await page.waitForTimeout(300)
    await page.locator('[cmdk-item]').first().click()
  }
  await page.waitForTimeout(800)

  let startBtn = page.getByRole('button', { name: /Start/i })
  let isDisabled = await startBtn.isDisabled()
  console.log('START_BTN_DISABLED_AFTER_RECIPE_SELECT:', isDisabled)

  if (isDisabled) {
    // Machine likely not "Ready" (MR303) yet — send a Reset pulse (mirrors operator flow) and retry.
    const resetBtn = page.getByRole('button', { name: /Reset/i })
    if (await resetBtn.isVisible().catch(() => false) && !(await resetBtn.isDisabled())) {
      await resetBtn.click()
      console.log('RESET_CLICKED_TO_MAKE_MACHINE_READY')
      await page.waitForTimeout(2000)
      isDisabled = await startBtn.isDisabled()
      console.log('START_BTN_DISABLED_AFTER_RESET:', isDisabled)
    } else {
      console.log('RESET_BUTTON_NOT_AVAILABLE_OR_DISABLED')
    }
  }

  if (!isDisabled) {
    await startBtn.click()
    console.log('START_CLICKED')
  } else {
    console.log('START_BUTTON_STILL_DISABLED — machine likely not ready (MR303 false) — skipping run start')
  }

  // Wait for the alarm dialog — mock sine wave (0->8N, 1s period) crosses 2N quickly
  const dialog = page.getByRole('alertdialog')
  let dialogAppeared = false
  try {
    await expect(dialog).toBeVisible({ timeout: 20000 })
    dialogAppeared = true
  } catch {
    dialogAppeared = false
  }
  console.log('DIALOG_APPEARED:', dialogAppeared)

  if (dialogAppeared) {
    await expect(dialog.getByText('Imada Tension Limit Reached', { exact: false })).toBeVisible()
    await page.screenshot({ path: 'test-results/qa_dialog.png', fullPage: true })

    const stateText = await page.locator('body').innerText()
    console.log('STATE_SNAPSHOT_WHILE_DIALOG_UP (first 600 chars):', stateText.slice(0, 600))

    const ackBtn = dialog.getByRole('button', { name: /Acknowledge/i })
    await ackBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5000 })
    console.log('ACK_CLICKED_DIALOG_CLOSED')

    await page.waitForTimeout(3000)
    const reappeared = await dialog.isVisible().catch(() => false)
    console.log('DIALOG_REAPPEARED_AFTER_ACK (3s window):', reappeared)

    await page.waitForTimeout(2000)
    const finalStateText = await page.locator('body').innerText()
    console.log('STATE_SNAPSHOT_AFTER_ACK (first 400 chars):', finalStateText.slice(0, 400))
  }

  console.log('CONSOLE_ERRORS_RUN_PAGE:', JSON.stringify(consoleErrors))
})

test('Hardware page — MR815 pill state check (post-run)', async ({ page }) => {
  await page.goto(`${BASE}/hardware`)
  await expect(page.getByText('PLC Signals', { exact: false })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(500)
  const bodyText = await page.locator('main').innerText()
  const idx = bodyText.indexOf('MR815')
  console.log('MR815_CONTEXT:', bodyText.slice(idx, idx + 40))
  await page.screenshot({ path: 'test-results/qa_hw_signals.png', fullPage: true })
})
