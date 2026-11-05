import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { clickState, expect, findAsked, openApp, openTab, test } from './fixtures'

// The installable, offline app: manifest, service worker and the new-version notice.
test.use({ serviceWorkers: 'allow' })

/** Waits until the service worker has saved the app's files and controls the page (after a reload). */
async function installed(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('can be installed: a manifest with name, start page and icons', async ({ page, request }) => {
  await openApp(page)
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await request.get(href!)).json()
  expect(manifest).toMatchObject({ name: 'Map Memory', display: 'standalone', start_url: '.' })
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512'])
  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), 'apple-touch-icon.png', 'favicon.svg']) {
    const res = await request.get(`/${icon}`)
    expect(res.status(), icon).toBe(200)
  }
})

test('works offline after the first visit: the map, Explore and a quiz', async ({ page, context }) => {
  await openApp(page)
  await installed(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('path[data-place-id]').first()).toBeAttached()
  await clickState(page, '#panel-explore', '06')
  await expect(page.locator('#panel-explore .info h2')).toContainText('California')
  await openTab(page, 'Find it')
  await page.locator('#panel-find button.start').click()
  await findAsked(page, '#panel-find')
  await expect(page.locator('#panel-find .prompt .muted')).toHaveText('2 of 50')
})

test('a new version: says so, and switches to it only on Reload', async ({ page }) => {
  const server = await serveBuild()
  try {
    await page.goto(server.url)
    await expect(page.locator('path[data-place-id]').first()).toBeAttached()
    await installed(page)
    const notice = page.getByText('A new version of Map Memory is ready')
    await expect(notice).toHaveCount(0)
    const checkForUpdate = () => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))

    // Publish a new version, as a new build would, and check for it
    server.version = 2
    await checkForUpdate()
    await expect(notice).toBeVisible()

    expect(await newVersionWaiting(page)).toBe(true)

    // Later hides the notice; an ordinary reload keeps the old version, and the notice comes back
    await page.getByRole('button', { name: 'Later' }).click()
    await expect(notice).toHaveCount(0)
    await page.reload()
    await expect(notice).toBeVisible()
    expect(await newVersionWaiting(page)).toBe(true)

    // Reload switches to it, and reloads the page
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Reload' }).click()])
    expect(await newVersionWaiting(page)).toBe(false)
    await expect(page.locator('path[data-place-id]').first()).toBeAttached()
    await expect(notice).toHaveCount(0)
  } finally {
    await server.close()
  }
})

/** Whether a new version has been downloaded and is waiting to take over from the one running */
function newVersionWaiting(page: Page) {
  return page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.waiting)))
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Serves the built app (dist/) on a port of its own, with `version` marked in the service worker, so a test
 * can publish a "new version". (The browser fetches the service worker itself when checking for updates,
 * so Playwright can't change it on the way.)
 */
async function serveBuild() {
  const root = fileURLToPath(new URL('../dist/', import.meta.url))
  const state = { version: 1 }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const file = join(root, path === '/' ? 'index.html' : normalize(path))
    try {
      let body: Buffer | string = await readFile(file)
      if (path === '/sw.js') body = `${body}\n// version ${state.version}\n`
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://localhost:${port}/`,
    set version(v: number) {
      state.version = v
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
