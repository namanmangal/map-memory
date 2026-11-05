import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { clickState, expect, findAsked, openApp, openTab, quiz, test } from './fixtures'

/**
 * Scans each screen with axe for accessibility problems, such as missing labels, low contrast or buttons
 * without a name, against WCAG 2.1 A and AA, in both themes.
 */
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  // One line per problem and element, so a failure says what to fix and where.
  const problems = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} — ${n.target.join(' ')}\n    ${n.failureSummary?.replace(/\n/g, ' ')}`),
  )
  expect(problems, 'accessibility problems').toEqual([])
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    test('Explore, with a state selected', async ({ page }) => {
      await openApp(page)
      await expectAccessible(page)
      await clickState(page, '#panel-explore', '06')
      await expect(page.locator('#panel-explore .fun-facts li')).toHaveCount(3)
      await expectAccessible(page)
    })

    test('Daily: before, during and after', async ({ page }) => {
      await openApp(page)
      await openTab(page, 'Daily')
      await expectAccessible(page)
      await page.getByRole('button', { name: "Start today's challenge" }).click()
      await findAsked(page, '#panel-daily')
      await expectAccessible(page)
      for (let i = 0; i < 9; i++) await findAsked(page, '#panel-daily')
      await expect(page.locator('#panel-daily .daily-squares')).toBeVisible()
      await expectAccessible(page)
    })

    test('Find it: during a quiz and its summary, then History', async ({ page }) => {
      await openApp(page)
      await openTab(page, 'Find it')
      await expectAccessible(page)
      await page.locator('#panel-find .toolbar select').selectOption('Northeast')
      await page.locator('#panel-find button.start').click()
      // A wrong answer first (a Northeast state other than the one asked), so feedback for a miss is on screen too
      const asked = await page.locator('#panel-find .ask strong').textContent()
      await clickState(page, '#panel-find', asked === 'New York' ? '42' : '36')
      await expectAccessible(page)
      for (let i = 0; i < 9; i++) await findAsked(page, '#panel-find')
      await expect(page.locator('#panel-find .summary')).toBeVisible()
      await expectAccessible(page)
      await openTab(page, 'History')
      await page.locator('#panel-history tbody tr').first().click()
      await expectAccessible(page)
    })

    test('Name it and Capitals, in each answer style', async ({ page }) => {
      await openApp(page)
      const quizzes = [
        { tab: 'Name it', panel: 'name', styles: ['Type', 'Choose'] },
        { tab: 'Capitals', panel: 'capitals', styles: ['Type', 'Choose', 'On the map'] },
      ]
      for (const { tab, panel, styles } of quizzes) {
        await openTab(page, tab)
        for (const style of styles) {
          await quiz(page, panel).getByRole('button', { name: style, exact: true }).click()
          await quiz(page, panel).locator('button.start').click()
          await expectAccessible(page)
        }
      }
    })

    test('Drag & drop, during a quiz', async ({ page }) => {
      await openApp(page)
      await openTab(page, 'Drag & drop')
      await page.locator('#panel-drag button.start').click()
      await page.locator('#panel-drag .tray .chip').first().click()
      await expectAccessible(page)
    })
  })
}
