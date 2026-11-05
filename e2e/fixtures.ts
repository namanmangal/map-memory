import { readFileSync } from 'node:fs'
import { test as base, expect, type Page } from '@playwright/test'

/** The US states, to look up the right answer for a prompt ("Click on Ohio") by name or capital. */
const places: { id: string; name: string; capital: string }[] = JSON.parse(
  readFileSync(new URL('../src/datasets/us-states/places.json', import.meta.url), 'utf8'),
)
export const idOfName = (name: string) => places.find((p) => p.name === name)!.id
export const idOfCapital = (capital: string) => places.find((p) => p.capital === capital)!.id
export const nameOf = (id: string) => places.find((p) => p.id === id)!.name
export const capitalOf = (id: string) => places.find((p) => p.id === id)!.capital

/**
 * Every test starts in a fresh browser profile (no saved progress). Photos from Wikimedia are
 * blocked, so tests don't depend on the network; any other console error fails the test.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ context }, use) => {
      const errors: string[] = []
      await context.route(/wikimedia\.org/, (route) => route.abort())
      context.on('page', (page) => watch(page, errors))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

function watch(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    // The blocked photos each log a failed load; any other error, including a failed load of
    // anything else (a stylesheet, script or icon), is a real one.
    if (m.type() === 'error' && !isBlockedPhoto(m.location().url)) {
      errors.push(`${m.text()}${m.location().url ? ` (${m.location().url})` : ''}`)
    }
  })
}

function isBlockedPhoto(url: string) {
  try {
    const host = new URL(url).hostname
    return host === 'wikimedia.org' || host.endsWith('.wikimedia.org')
  } catch {
    return false
  }
}

/** Opens the app and waits for the map. */
export async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.locator('path[data-place-id]').first()).toBeAttached()
}

export async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click()
}

/** The visible quiz inside a tab (Name it and Capitals keep one per answer style, all but one hidden). */
export const quiz = (page: Page, tab: string) => page.locator(`#panel-${tab} .quiz:visible`).first()

/** Clicks a state's shape on a map (not its capital star, which shares its id). */
export async function clickState(page: Page, scope: string, id: string) {
  await page.locator(`${scope} path.place[data-place-id="${id}"]`).dispatchEvent('click')
}

/** Answers a "Click on Ohio" prompt (Find it, Daily) correctly. */
export async function findAsked(page: Page, scope: string) {
  const name = await page.locator(`${scope} .ask strong`).textContent()
  await clickState(page, scope, idOfName(name!))
}
