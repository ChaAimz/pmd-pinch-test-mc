import { test, expect } from '@playwright/test'

test.describe('Recipes CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/recipes')
  })

  test('empty state shows prompt', async ({ page }) => {
    const hasRows = page.getByRole('row').nth(1)
    const isEmpty = !(await hasRows.isVisible().catch(() => false))
    if (isEmpty) await expect(page.getByText('No recipes yet')).toBeVisible()
  })

  test('create a recipe', async ({ page }) => {
    await page.getByRole('button', { name: '+ New Recipe' }).click()
    await page.getByLabel('Name').fill('E2E Smoke Recipe')
    await page.getByLabel('Position (mm)').fill('80')
    await page.getByLabel('Speed (mm/s)').fill('12')
    await page.getByLabel('Clamp Threshold (N)').fill('35')
    await page.getByLabel('Loops').fill('4')
    await page.getByLabel('Hold Time (ms)').fill('600')
    await page.getByRole('button', { name: 'Create Recipe' }).click()
    await expect(page.getByText('E2E Smoke Recipe')).toBeVisible()
  })

  test('edit a recipe', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).first().click()
    const nameInput = page.getByLabel('Name')
    await nameInput.clear()
    await nameInput.fill('Renamed Recipe')
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Renamed Recipe')).toBeVisible()
  })

  test('delete a recipe', async ({ page }) => {
    const rowsBefore = await page.getByRole('row').count()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await expect(page.getByRole('row')).toHaveCount(rowsBefore - 1)
  })
})
