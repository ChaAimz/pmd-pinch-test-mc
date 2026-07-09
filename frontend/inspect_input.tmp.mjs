import { chromium } from '@playwright/test'

const shots = 'C:/Users/pmd/AppData/Local/Temp/claude/c--Users-pmd-source-repo-pmd-pinch-test-mc/c51d8e4b-1377-4fdc-9816-c7a95b32403d/scratchpad'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })

await page.goto('http://127.0.0.1:5173/history/197', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const exportBtn = page.getByRole('button', { name: /Export CSV/i }).first()
console.log('export btn count:', await exportBtn.count())
await exportBtn.waitFor({ state: 'visible', timeout: 15000 })
await exportBtn.click()
const dialog = page.getByRole('dialog')
await dialog.waitFor({ state: 'visible', timeout: 15000 })
console.log('dialog visible')

const folderInput = dialog.locator('#export-folder')
console.log('folder input count:', await folderInput.count())
await folderInput.click({ timeout: 15000 })
await page.waitForTimeout(300)

const styles = await page.evaluate(() => {
  const el = document.querySelector('#export-folder')
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return {
    height: cs.height,
    lineHeight: cs.lineHeight,
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    borderTop: cs.borderTopWidth,
    borderBottom: cs.borderBottomWidth,
    boxSizing: cs.boxSizing,
    rectHeight: rect.height,
  }
})
console.log('Folder input computed style:', styles)

await page.locator('#export-folder').screenshot({ path: `${shots}/folder-input-closeup.png` })
await page.screenshot({ path: `${shots}/dialog-closeup.png` })

await browser.close()
