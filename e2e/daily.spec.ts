import type { Page } from '@playwright/test'
import { expect, findAsked, openApp, openTab, test } from './fixtures'

const daily = '#panel-daily'

/**
 * Stands in for the clipboard, which browsers guard differently: records what the app copies (in
 * `window.copied`), or refuses, like a browser that doesn't allow it.
 */
async function fakeClipboard(page: Page, allow: boolean) {
  await page.addInitScript((allow) => {
    const writeText = async (text: string) => {
      if (!allow) throw new DOMException('Not allowed', 'NotAllowedError')
      ;(window as unknown as { copied: string }).copied = text
    }
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }, allow)
}

/** Plays the day's challenge to the end, answering everything right */
async function finishDaily(page: Page) {
  await openTab(page, 'Daily')
  await page.getByRole('button', { name: "Start today's challenge" }).click()
  for (let i = 0; i < 10; i++) await findAsked(page, daily)
}

test('Daily: a reload continues the challenge; finishing shows the result, streak and share text', async ({ page }) => {
  await fakeClipboard(page, true)
  await openApp(page)
  await openTab(page, 'Daily')
  await expect(page.locator(`${daily} .prompt .ask`)).toHaveText('10 states — ready?')
  await page.getByRole('button', { name: "Start today's challenge" }).click()
  for (let i = 0; i < 3; i++) await findAsked(page, daily)
  await expect(page.locator(`${daily} .prompt .muted`)).toHaveText('4 of 10')

  // Reloading can't restart it: only Continue, from where it was
  await page.reload()
  await openTab(page, 'Daily')
  await expect(page.locator(`${daily} .prompt .ask`)).toHaveText('In progress: 3 of 10 done')
  await expect(page.getByRole('button', { name: "Start today's challenge" })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator(`${daily} .prompt .muted`)).toHaveText('4 of 10')
  for (let i = 0; i < 7; i++) await findAsked(page, daily)

  await expect(page.locator(`${daily} .daily-squares`)).toHaveText('🟩'.repeat(10))
  await expect(page.locator(`${daily} .toolbar`)).toContainText('1-day streak')
  await page.getByRole('button', { name: 'Copy result to share' }).click()
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible()
  const shared = await page.evaluate(() => (window as unknown as { copied: string }).copied)
  expect(shared).toContain('Map Memory · US States')
  expect(shared).toContain('🟩'.repeat(10))
  expect(shared).toContain('10/10 first try')
})

test("Daily: if the browser won't allow copying, the result is shown to copy by hand", async ({ page }) => {
  await fakeClipboard(page, false)
  await openApp(page)
  await finishDaily(page)
  await page.getByRole('button', { name: 'Copy result to share' }).click()
  const text = page.getByRole('textbox', { name: /copy this/ })
  await expect(text).toBeVisible()
  await expect(text).toHaveValue(/10\/10 first try/)
})

test('Reset progress clears the daily challenge too', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await openApp(page)
  await openTab(page, 'Daily')
  await page.getByRole('button', { name: "Start today's challenge" }).click()
  await findAsked(page, daily)

  await openTab(page, 'Explore')
  await page.getByRole('button', { name: 'Reset progress' }).click()
  await expect(page.getByRole('button', { name: 'Reset progress' })).toBeDisabled()
  await openTab(page, 'Daily')
  await expect(page.getByRole('button', { name: "Start today's challenge" })).toBeVisible()
})

test('Daily: continuing in a second tab takes the challenge over', async ({ context }) => {
  const a = await context.newPage()
  await openApp(a)
  await openTab(a, 'Daily')
  await a.getByRole('button', { name: "Start today's challenge" }).click()
  await findAsked(a, daily)

  const b = await context.newPage()
  await openApp(b)
  await openTab(b, 'Daily')
  await expect(b.locator(`${daily} .prompt .ask`)).toHaveText('In progress: 1 of 10 done')
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(b.locator(`${daily} .prompt .muted`)).toHaveText('2 of 10')

  await expect(a.locator(`${daily} .daily-notice`)).toContainText('You continued this challenge in another tab')
  await expect(a.locator(`${daily} .ask strong`)).toHaveCount(0)
})

test('an answer saved in one tab shows in another without reloading', async ({ context }) => {
  const watching = await context.newPage()
  await openApp(watching)
  await expect(watching.getByRole('button', { name: 'Reset progress' })).toBeDisabled()

  const playing = await context.newPage()
  await openApp(playing)
  await openTab(playing, 'Find it')
  await playing.locator('#panel-find button.start').click()
  await findAsked(playing, '#panel-find')

  await expect(watching.getByRole('button', { name: 'Reset progress' })).toBeEnabled()
})
