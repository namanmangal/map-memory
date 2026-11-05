import { clickState, expect, openApp, openTab, test } from './fixtures'

test('every tab opens', async ({ page }) => {
  await openApp(page)
  const tabs = ['Explore', 'Daily', 'Find it', 'Name it', 'Drag & drop', 'Capitals', 'History']
  await expect(page.getByRole('tab')).toHaveText(tabs)
  for (const tab of tabs) {
    await openTab(page, tab)
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toBeVisible()
  }
  await expect(page.locator('#panel-history')).toContainText('No quizzes yet')
})

test("Explore shows a state's capital, facts and fun facts", async ({ page }) => {
  await openApp(page)
  await clickState(page, '#panel-explore', '06')
  const info = page.locator('#panel-explore .info')
  await expect(info.locator('h2')).toContainText('California')
  await expect(info).toContainText('Sacramento')
  await expect(info).toContainText('Golden State')

  const facts = page.locator('#panel-explore .fun-facts li')
  await expect(facts).toHaveCount(3)
  for (const link of await page.locator('#panel-explore .fun-facts a').all()) {
    await expect(link).toHaveAttribute('href', /^https:\/\/en\.wikipedia\.org\/wiki\//)
    await expect(link).toHaveAttribute('aria-label', /^Source: .+ \(Wikipedia\)$/)
  }
})

test("the browser's bar matches the page, in either theme", async ({ page }) => {
  await openApp(page)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f5f1')
  await page.getByRole('button', { name: 'Dark theme' }).click()
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#161614')
})
