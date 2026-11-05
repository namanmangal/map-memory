// @vitest-environment happy-dom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyRecord } from './progress'

// Saved progress, tested against an in-memory IndexedDB. Each test starts with an empty database and
// a fresh copy of the module (it keeps the open map's progress in memory); `reopen` loads another fresh
// copy on the same database — like reloading the page — to check what was actually saved.

const DS = 'us-states'
const DAY = '2026-10-30'
let progress: typeof import('./progress')

async function reopen() {
  vi.resetModules()
  progress = await import('./progress')
  await progress.openProgress(DS)
  return progress
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  globalThis.IDBKeyRange = IDBKeyRange
  // One tab at a time here: no cross-tab messages.
  ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined
  localStorage.clear()
  await reopen()
})

const gen = () => progress.progressGeneration(DS)
const record = (ids: string[], result: 'first' | 'missed' = 'first'): DailyRecord => ({
  ids,
  ms: 1000,
  results: Object.fromEntries(ids.map((id) => [id, result])),
})

describe('answers, best scores and history', () => {
  it('saves answers, and they are still there after reopening', async () => {
    progress.recordAnswer(DS, '06', true, 'place', gen())
    await vi.waitFor(() => expect(progress.loadStats(DS)['06']).toEqual({ seen: 1, firstTry: 1 }))
    progress.recordAnswer(DS, '06', false, 'place', gen())
    progress.recordAnswer(DS, '48', true, 'capital', gen())
    await vi.waitFor(() => expect(progress.loadStats(DS)['06']).toEqual({ seen: 2, firstTry: 1 }))
    await vi.waitFor(() => expect(progress.loadStats(DS, 'capital')['48']).toEqual({ seen: 1, firstTry: 1 }))

    await reopen()
    expect(progress.loadStats(DS)['06']).toEqual({ seen: 2, firstTry: 1 })
    expect(progress.loadStats(DS, 'capital')['48']).toEqual({ seen: 1, firstTry: 1 })
  })

  it('keeps the better best score: more right, then faster', async () => {
    expect(await progress.saveBest(DS, 'find:West', { correct: 10, total: 13, ms: 9000 }, gen())).toBe(true)
    expect(await progress.saveBest(DS, 'find:West', { correct: 9, total: 13, ms: 1000 }, gen())).toBe(false)
    expect(await progress.saveBest(DS, 'find:West', { correct: 10, total: 13, ms: 8000 }, gen())).toBe(true)
    expect(progress.loadBest(DS, 'find:West')).toEqual({ correct: 10, total: 13, ms: 8000 })
  })

  it('replaces a best score over a different number of places, even with fewer right', async () => {
    await progress.saveBest(DS, 'find:West', { correct: 10, total: 10, ms: 1000 }, gen())
    expect(await progress.saveBest(DS, 'find:West', { correct: 8, total: 9, ms: 5000 }, gen())).toBe(true)
  })

  it('adds runs to history in order', async () => {
    await progress.saveRun(DS, { mode: 'find', group: 'All', practice: false, ms: 1, results: { '06': 'first' } }, gen())
    await progress.saveRun(DS, { mode: 'drag', group: 'West', practice: true, ms: 2, results: { '06': 'missed' } }, gen())
    await reopen()
    expect(progress.loadRuns(DS).map((r) => [r.mode, r.practice])).toEqual([
      ['find', false],
      ['drag', true],
    ])
  })
})

describe('daily challenge', () => {
  const ids = ['06', '48', '36']

  it('saves the result of the tab playing it, and clears the attempt in progress', async () => {
    const attempt = await progress.beginAttempt(DS, DAY, ids, 'tab-a', gen())
    expect(attempt).toMatchObject({ ids, results: {}, owner: 'tab-a' })
    expect(await progress.saveAttempt(DS, DAY, 'tab-a', { results: { '06': 'first' }, mistakes: 1, ms: 500 }, gen())).toBe('saved')

    // A reload continues where it was
    await reopen()
    expect(progress.loadAttempt(DS, DAY)).toMatchObject({ results: { '06': 'first' }, mistakes: 1, ms: 500 })

    const claim = await progress.claimDaily(DS, DAY, record(ids), 'tab-a', gen())
    expect(claim.status).toBe('saved')
    await reopen()
    expect(progress.loadDaily(DS)[DAY]).toEqual(record(ids))
    expect(progress.loadAttempt(DS, DAY)).toBeUndefined()
  })

  it('keeps the first result: a second finish gets the saved one back', async () => {
    await progress.beginAttempt(DS, DAY, ids, 'tab-a', gen())
    await progress.claimDaily(DS, DAY, record(ids, 'first'), 'tab-a', gen())
    const second = await progress.claimDaily(DS, DAY, record(ids, 'missed'), 'tab-a', gen())
    expect(second.status).toBe('already-played')
    expect(second.record).toEqual(record(ids, 'first'))
  })

  it('hands an attempt to the tab that continues it; the other tab can no longer save or finish', async () => {
    await progress.beginAttempt(DS, DAY, ids, 'tab-a', gen())
    await progress.beginAttempt(DS, DAY, ids, 'tab-b', gen())
    expect(await progress.saveAttempt(DS, DAY, 'tab-a', { results: {}, mistakes: 0, ms: 1 }, gen())).toBe('taken-over')
    expect((await progress.claimDaily(DS, DAY, record(ids), 'tab-a', gen())).status).toBe('taken-over')
    expect((await progress.claimDaily(DS, DAY, record(ids), 'tab-b', gen())).status).toBe('saved')
  })

  it("won't start a day that already has a result", async () => {
    await progress.beginAttempt(DS, DAY, ids, 'tab-a', gen())
    await progress.claimDaily(DS, DAY, record(ids), 'tab-a', gen())
    expect(await progress.beginAttempt(DS, DAY, ids, 'tab-b', gen())).toBeNull()
    expect(progress.loadAttempt(DS, DAY)).toBeUndefined()
  })
})

describe('reset', () => {
  it('clears everything, also after reopening', async () => {
    progress.recordAnswer(DS, '06', true, 'place', gen())
    await vi.waitFor(() => expect(progress.hasProgress(DS)).toBe(true))
    await progress.saveRun(DS, { mode: 'find', group: 'All', practice: false, ms: 1, results: { '06': 'first' } }, gen())
    await progress.beginAttempt(DS, DAY, ['06'], 'tab-a', gen())

    expect(await progress.resetProgress(DS)).toBe(true)
    expect(progress.hasProgress(DS)).toBe(false)
    await reopen()
    expect(progress.hasProgress(DS)).toBe(false)
  })

  it('refuses every change from a quiz that started before it', async () => {
    const before = gen()
    await progress.resetProgress(DS)
    expect(gen()).toBeGreaterThan(before)

    progress.recordAnswer(DS, '06', true, 'place', before)
    await progress.saveRun(DS, { mode: 'find', group: 'All', practice: false, ms: 1, results: { '06': 'first' } }, before)
    expect(await progress.saveBest(DS, 'find:All', { correct: 1, total: 1, ms: 1 }, before)).toBe(false)
    expect(await progress.beginAttempt(DS, DAY, ['06'], 'tab-a', before)).toBeNull()
    expect((await progress.claimDaily(DS, DAY, record(['06']), 'tab-a', before)).status).toBe('stale')

    await reopen()
    expect(progress.hasProgress(DS)).toBe(false)
  })
})

describe('moving progress from older versions (localStorage)', () => {
  const set = (key: string, value: unknown) => localStorage.setItem(`map-memory:${DS}:${key}`, JSON.stringify(value))

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    set('stats', { '06': { seen: 3, firstTry: 2 }, '99': { seen: 1, firstTry: 5 } }) // the second is impossible
    set('capital-stats', { '48': { seen: 1, firstTry: 1 } })
    set('best', { 'find:West': { correct: 13, total: 13, ms: 5000 } })
    set('runs', [{ id: 'r_1', date: '2026-01-01T00:00:00.000Z', mode: 'find', group: 'West', practice: false, ms: 1, results: { '06': 'first' } }, { id: 'bad' }])
    set('daily', { '2026-01-01': record(['06']), '2026-01-02': record(['06'], 'missed') }) // the oldest format
    set('daily:2026-01-02', record(['06'])) // then one key per day, which is newer
    await reopen()
  })

  it('moves valid progress in, dropping damaged entries', () => {
    expect(progress.loadStats(DS)).toEqual({ '06': { seen: 3, firstTry: 2 } })
    expect(progress.loadStats(DS, 'capital')).toEqual({ '48': { seen: 1, firstTry: 1 } })
    expect(progress.loadBest(DS, 'find:West')).toEqual({ correct: 13, total: 13, ms: 5000 })
    expect(progress.loadRuns(DS).map((r) => r.id)).toEqual(['r_1'])
  })

  it('takes a per-day result over the older all-days one', () => {
    expect(progress.loadDaily(DS)['2026-01-01']).toEqual(record(['06']))
    expect(progress.loadDaily(DS)['2026-01-02']).toEqual(record(['06']))
  })

  it('removes the old copies and moves them only once', async () => {
    expect(Object.keys(localStorage).filter((k) => k.startsWith(`map-memory:${DS}:`))).toEqual([])
    set('stats', { '01': { seen: 1, firstTry: 1 } }) // left behind by an old tab: ignored now
    await reopen()
    expect(progress.loadStats(DS)).toEqual({ '06': { seen: 3, firstTry: 2 } })
    expect(progress.loadRuns(DS)).toHaveLength(1)
  })
})

describe('without IndexedDB', () => {
  beforeEach(async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = undefined
    // The app warns in the console that progress isn't being saved: expected here.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await reopen()
    return () => vi.restoreAllMocks()
  })

  it('keeps progress in memory and says it is not being saved', async () => {
    expect(progress.saving()).toBe('paused')
    progress.recordAnswer(DS, '06', true, 'place', gen())
    await vi.waitFor(() => expect(progress.loadStats(DS)['06']).toEqual({ seen: 1, firstTry: 1 }))
    expect(progress.saving()).toBe('no')
  })

  it('resets the copy in memory (nothing was ever saved)', async () => {
    progress.recordAnswer(DS, '06', true, 'place', gen())
    await vi.waitFor(() => expect(progress.hasProgress(DS)).toBe(true))
    expect(await progress.resetProgress(DS)).toBe(true)
    expect(progress.hasProgress(DS)).toBe(false)
  })
})
