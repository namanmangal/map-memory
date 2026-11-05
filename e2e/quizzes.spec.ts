import { capitalOf, clickState, expect, findAsked, idOfCapital, idOfName, nameOf, openApp, openTab, quiz, test } from './fixtures'

test('Find it: a perfect region run shows a summary, a best score and a History entry', async ({ page }) => {
  await openApp(page)
  await openTab(page, 'Find it')
  const find = '#panel-find'
  await page.locator(`${find} .toolbar select`).selectOption('Northeast')
  await page.locator(`${find} button.start`).click()
  for (let i = 0; i < 9; i++) await findAsked(page, find)

  await expect(page.locator(`${find} .summary h2`)).toHaveText('Perfect!')
  await expect(page.locator(`${find} .toolbar`)).toContainText('Best: 9/9')
  await openTab(page, 'History')
  await expect(page.locator('#panel-history tbody tr').first()).toContainText('Find it')
})

test('Name it: picking the highlighted state moves on', async ({ page }) => {
  await openApp(page)
  await openTab(page, 'Name it')
  const name = quiz(page, 'name')
  await name.getByRole('button', { name: 'Choose' }).click()
  await name.locator('button.start').click()
  const id = await name.locator('path.place.target').getAttribute('data-place-id')
  await name.locator('.choices').getByRole('button', { name: nameOf(id!), exact: true }).click()
  await expect(name.locator('.prompt .muted')).toHaveText('2 of 50')
  await expect(name.locator('.feedback')).toContainText(`✓ ${nameOf(id!)}`)
})

test('Capitals: typing the capital, and finding the state on the map', async ({ page }) => {
  await openApp(page)
  await openTab(page, 'Capitals')
  let capitals = quiz(page, 'capitals')
  await capitals.locator('button.start').click()
  const state = await capitals.locator('.ask strong').textContent()
  await capitals.getByLabel('Your answer').fill(capitalOf(idOfName(state!)))
  await capitals.getByRole('button', { name: 'Check' }).click()
  await expect(capitals.locator('.prompt .muted')).toHaveText('2 of 50')

  await capitals.getByRole('button', { name: 'On the map' }).click()
  capitals = quiz(page, 'capitals')
  await capitals.locator('button.start').click()
  const capital = await capitals.locator('.ask strong').textContent()
  await capitals.locator(`path.place[data-place-id="${idOfCapital(capital!)}"]`).dispatchEvent('click')
  await expect(capitals.locator('.prompt .muted')).toHaveText('2 of 50')
})

test('Drag & drop: tapping a name then its state places it', async ({ page }) => {
  await openApp(page)
  await openTab(page, 'Drag & drop')
  const drag = '#panel-drag'
  await page.locator(`${drag} button.start`).click()
  const chip = page.locator(`${drag} .tray .chip`).first()
  const name = (await chip.textContent())!
  await chip.click()
  await clickState(page, drag, idOfName(name))
  await expect(page.locator(`${drag} .prompt .muted`)).toHaveText('1 of 50 placed')
  await expect(page.locator(`${drag} .tray .chip`, { hasText: name })).toHaveCount(0)
})
