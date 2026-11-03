/**
 * Per-place learning stats, best scores, quiz history and daily challenge results, namespaced by
 * dataset. Saved in IndexedDB (see progressDb), where every change is an atomic transaction, so tabs
 * open at the same time can't overwrite each other's progress.
 *
 * Each tab keeps a copy of the open map's progress in memory, so reading is instant and synchronous
 * (`loadStats`, `loadRuns`, …). Writes go to IndexedDB first; once committed, the copy is refreshed,
 * components using `useProgress` re-render, and other tabs are told to refresh theirs.
 *
 * If IndexedDB can't be opened, progress is kept in memory only, for as long as the tab is open
 * (`saving` says which).
 */
import { useSyncExternalStore } from 'react'
import type { Result } from '../modes/useQuizRun'
import { datasetRange, openDb, PROGRESS_STORES, request, transact, type StoreName } from './progressDb'

export type PlaceStat = { seen: number; firstTry: number }
export type Stats = Record<string, PlaceStat>
export type Best = { correct: number; total: number; ms: number }

/** Map quizzes (daily, find, name, drag) and the Capitals quiz keep separate per-place stats. */
export type StatsKind = 'place' | 'capital'
const STATS_KINDS: StatsKind[] = ['place', 'capital']

/** Which stats a quiz `mode` (as stored with runs, e.g. "capital-map") records answers into. */
export const statsKindOf = (mode: string): StatsKind => (mode.startsWith('capital-') ? 'capital' : 'place')

/** Which quiz a run was, where, and whether it was a "practice the ones you missed" run */
export type RunMeta = { mode: string; group: string; practice: boolean }

/** One finished quiz run */
export type RunRecord = RunMeta & {
  id: string
  /** ISO timestamp of when the run finished */
  date: string
  /** Time taken, excluding pauses and time on other tabs */
  ms: number
  /** Outcome for every place in the run */
  results: Record<string, Result>
}

/** The first finished run of a day's challenge; later runs that day are practice and aren't kept here */
export type DailyRecord = {
  /**
   * The challenge's places, in the order asked. Kept with the result so it always shows against the
   * places actually played, even if the map data or the way challenges are picked changes later.
   */
  ids: string[]
  /** Time taken, excluding pauses and time on other tabs */
  ms: number
  /** Outcome for every place in `ids`, and nothing else */
  results: Record<string, Result>
}

/**
 * A day's challenge in progress, saved after every answer and miss, so reloading continues it rather
 * than starting over (which would let someone retry until they liked the result). It's played in one
 * tab at a time: `owner` is the tab playing it, and only that tab's saves are accepted.
 */
export type DailyAttempt = {
  /** The challenge's places, in the order asked */
  ids: string[]
  /** Places answered so far */
  results: Record<string, Result>
  /** Misses on the current question */
  mistakes: number
  /** Time spent so far */
  ms: number
  owner: string
}

/** Where an attempt has got to: what's saved after each answer */
export type AttemptProgress = Pick<DailyAttempt, 'results' | 'mistakes' | 'ms'>

/**
 * What happened to a daily result: kept; refused because the day already has one, because another
 * tab took the attempt over, or because progress was reset since it started (`stale`); or not saved.
 */
export type DailySave = 'saved' | 'already-played' | 'taken-over' | 'stale' | 'failed'

/** How a claim went: the outcome, the day's result (another tab's, if it won), and whether it's saved */
export type DailyClaim = { status: DailySave; record: DailyRecord; stored: boolean }

/** History keeps the newest runs; a full 50-state run is ~1.5 KB. */
const MAX_RUNS = 2000

// ----- Checking stored data: it may be from an older version, or damaged -----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Counts (answers seen, correct, total) are whole numbers. */
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
/** Durations in milliseconds may be fractional, but must be real, nonnegative numbers. */
const isDuration = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const RESULT_VALUES: Result[] = ['first', 'second', 'third', 'missed']

const isStat = (v: unknown): v is PlaceStat => isRecord(v) && isCount(v.seen) && isCount(v.firstTry) && v.firstTry <= v.seen
// An impossible record (e.g. 999 of 1) would never be beaten, so it's dropped like any damaged entry.
const isBest = (v: unknown): v is Best =>
  isRecord(v) && isCount(v.correct) && isCount(v.total) && v.total > 0 && v.correct <= v.total && isDuration(v.ms)
const isResult = (v: unknown): v is Result => RESULT_VALUES.includes(v as Result)
const isRun = (v: unknown): v is RunRecord =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.date === 'string' &&
  !Number.isNaN(Date.parse(v.date)) && // History formats it; an unparseable date would throw
  typeof v.mode === 'string' &&
  typeof v.group === 'string' &&
  typeof v.practice === 'boolean' &&
  isDuration(v.ms) &&
  isRecord(v.results) &&
  Object.keys(v.results).length > 0 &&
  Object.values(v.results).every(isResult)
const isDayKey = (k: unknown): k is string => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k)
/** The challenge's places: a non-empty list of distinct ids. */
const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((id) => typeof id === 'string') && new Set(v).size === v.length
/** A result for exactly the challenge's places: one valid outcome for each id, and no others. */
/** Answers so far: only places in the challenge, each with a valid outcome. */
const isAttempt = (v: unknown): v is DailyAttempt =>
  isRecord(v) &&
  isIdList(v.ids) &&
  isRecord(v.results) &&
  Object.entries(v.results).every(([id, r]) => (v.ids as string[]).includes(id) && isResult(r)) &&
  isCount(v.mistakes) &&
  isDuration(v.ms) &&
  typeof v.owner === 'string'
const isDaily = (v: unknown): v is DailyRecord =>
  isRecord(v) &&
  isDuration(v.ms) &&
  isIdList(v.ids) &&
  isRecord(v.results) &&
  Object.keys(v.results).length === v.ids.length &&
  v.ids.every((id) => Object.hasOwn(v.results as object, id) && isResult((v.results as Record<string, unknown>)[id]))

// ----- The in-memory copy, and telling React and other tabs about changes -----

type Snapshot = {
  stats: Record<StatsKind, Stats>
  best: Record<string, Best>
  /** Oldest first */
  runs: RunRecord[]
  /** Keyed by "YYYY-MM-DD" */
  daily: Record<string, DailyRecord>
  /** Daily challenges in progress, keyed by "YYYY-MM-DD" */
  attempts: Record<string, DailyAttempt>
  /** Bumped by every reset; see `progressGeneration` */
  generation: number
}

const emptySnapshot = (generation = 0): Snapshot => ({
  stats: { place: {}, capital: {} },
  best: {},
  runs: [],
  daily: {},
  attempts: {},
  generation,
})

let db: IDBDatabase | null = null
let opening: Promise<IDBDatabase | null> | null = null
/** Whether progress is being saved right now (shown to the user when it isn't). */
let persistent = true
/**
 * Set once anything is changed in memory only. From then on this tab stays memory-only, even if the
 * database becomes available: switching to it would reload the saved progress over the changes made
 * meanwhile, losing them.
 */
let memoryOnly = false
/** Set when a save fails after the database opened (e.g. storage is full); cleared by the next one that works. */
let failing = false
/** How long to wait for a blocked database before carrying on in memory meanwhile. */
const BLOCKED_WAIT_MS = 3000

/**
 * The open database. Opens it when needed: at first, after a failure (tried again next time, rather
 * than giving up for good), and after another tab deleted it or a newer version of the app started
 * upgrading it, which closes this tab's connection. While it's blocked (another tab hasn't let go
 * yet), this waits a few seconds, then lets callers carry on in memory. If it opens before anything was
 * changed in memory, it's used from then on (reloading this tab's copy of progress from it); after
 * that, this tab stays memory-only (see `memoryOnly`).
 */
function getDb(): Promise<IDBDatabase | null> {
  if (db) return Promise.resolve(db)
  if (memoryOnly) return Promise.resolve(null)
  opening ??= openDb().then(
    (opened) => {
      if (memoryOnly) {
        opened.close()
        return null
      }
      db = opened
      opened.onversionchange = () => {
        opened.close()
        if (db === opened) db = null
        opening = null
        reloadAll()
      }
      // Closed by the browser itself (e.g. the storage was cleared, or it hit an internal error): forget
      // the dead connection, so the next read or write opens a new one. Reloading straight away does
      // that, and catches up on anything missed; if it can't reopen, the app shows saving is paused.
      opened.onclose = () => {
        console.warn('The progress database closed unexpectedly; reopening it.')
        if (db === opened) db = null
        opening = null
        reloadAll()
      }
      if (!persistent) {
        persistent = true
        reloadAll()
      }
      changed()
      return opened
    },
    (e: unknown) => {
      if (persistent) console.warn('Progress is only being kept in this tab for now:', e)
      persistent = false
      opening = null
      changed()
      return null
    },
  )
  const gaveUp = new Promise<null>((resolve) => setTimeout(() => resolve(null), BLOCKED_WAIT_MS))
  return Promise.race([
    opening,
    gaveUp.then(() => {
      if (!db && persistent) {
        persistent = false
        changed()
      }
      return db
    }),
  ])
}

/** Reloads every open map's progress from the database (after reopening it). */
function reloadAll() {
  for (const id of snapshots.keys()) void refresh(id, PROGRESS_STORES)
}
const snapshots = new Map<string, Snapshot>()
const snap = (datasetId: string) => snapshots.get(datasetId) ?? emptySnapshot()

let version = 0
const listeners = new Set<() => void>()
function changed() {
  version++
  listeners.forEach((l) => l())
}

/** Re-renders the calling component whenever saved progress changes, in this tab or another. */
export function useProgress(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => version,
  )
}

type Changed = { datasetId: string; stores: StoreName[] }
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('map-memory-progress') : null
channel?.addEventListener('message', (e: MessageEvent<Changed>) => {
  if (snapshots.has(e.data.datasetId)) void refresh(e.data.datasetId, e.data.stores)
})

/** Tells other tabs that a map's stores changed, so they reload them. */
function publish(datasetId: string, stores: StoreName[]) {
  channel?.postMessage({ datasetId, stores } satisfies Changed)
}

/**
 * For each map, the stores whose copy here couldn't be reloaded, even after retrying: what's shown from
 * them may be out of date. A store leaves the set only when it is itself reloaded successfully.
 */
const outOfDate = new Map<string, Set<StoreName>>()
/** Waits between attempts to reload progress after a failure. */
const REFRESH_RETRY_MS = [1000, 3000]

/** Maps reset by another tab since this one loaded them (until the notice about it is dismissed). */
const resetElsewhere = new Set<string>()

/** Whether another tab reset this map's progress, which restarted the quizzes here. */
export function wasResetElsewhere(datasetId: string): boolean {
  return resetElsewhere.has(datasetId)
}

export function dismissResetNotice(datasetId: string) {
  if (resetElsewhere.delete(datasetId)) changed()
}

/** Whether a map's progress shown here may be out of date, because reloading it kept failing. */
export function progressOutOfDate(datasetId: string): boolean {
  return (outOfDate.get(datasetId)?.size ?? 0) > 0
}

/** For each map and store, a number bumped by every reload of it, so a retry can tell it's been superseded. */
const refreshSeq = new Map<string, number>()
const seqKey = (datasetId: string, store: StoreName) => `${datasetId}/${store}`

/**
 * Re-reads the given stores of a map into memory, then tells React. Never rejects, and resolves after
 * the first try: if that fails, it's retried a couple of times in the background (so a caller waiting
 * on it isn't held up), and if it still can't be done those stores are marked out of date (see
 * `progressOutOfDate`) until a later reload of them works. Each retry reads, applies and clears only
 * the stores no newer reload has taken over since (that reload decides their state), and retrying
 * stops once there are none left.
 */
async function refresh(datasetId: string, stores: StoreName[]): Promise<void> {
  const mine = new Map(stores.map((store) => {
    const n = (refreshSeq.get(seqKey(datasetId, store)) ?? 0) + 1
    refreshSeq.set(seqKey(datasetId, store), n)
    return [store, n] as const
  }))
  /** This reload's stores that no newer reload has started on since */
  const current = () => stores.filter((store) => refreshSeq.get(seqKey(datasetId, store)) === mine.get(store))
  const tryOnce = async (owned: StoreName[]) => {
    const db = await getDb()
    if (!db) return
    const fresh = await readStores(db, datasetId, owned)
    // A new generation read back from the database means another tab reset it (this tab's own resets
    // update the copy here directly).
    if (fresh.generation !== undefined && fresh.generation !== snap(datasetId).generation) resetElsewhere.add(datasetId)
    snapshots.set(datasetId, { ...snap(datasetId), ...fresh })
    for (const store of owned) outOfDate.get(datasetId)?.delete(store)
    changed()
  }
  try {
    await tryOnce(stores)
  } catch {
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        await new Promise((r) => setTimeout(r, REFRESH_RETRY_MS[attempt]))
        const owned = current()
        if (owned.length === 0) return // every store has a newer reload in charge of it
        try {
          return await tryOnce(owned)
        } catch (e) {
          if (attempt + 1 < REFRESH_RETRY_MS.length) continue
          const stillMine = current()
          if (stillMine.length === 0) return
          console.warn('Couldn’t reload progress:', e)
          const stale = outOfDate.get(datasetId) ?? new Set<StoreName>()
          for (const store of stillMine) stale.add(store)
          outOfDate.set(datasetId, stale)
          changed()
          return
        }
      }
    })()
  }
}

async function readStores(database: IDBDatabase, datasetId: string, stores: StoreName[]): Promise<Partial<Snapshot>> {
  return transact(database, [...stores, 'meta'], 'readonly', async (tx) => {
    const out: Partial<Snapshot> = { generation: await generationIn(tx, datasetId) }
    const entries = async (name: StoreName) => {
      const store = tx.objectStore(name)
      const [keys, values] = await Promise.all([request(store.getAllKeys(datasetRange(datasetId))), request(store.getAll(datasetRange(datasetId)))])
      return keys.map((k, i) => [k as IDBValidKey[], values[i] as unknown] as const)
    }
    if (stores.includes('stats')) {
      const stats: Record<StatsKind, Stats> = { place: {}, capital: {} }
      for (const [[, kind, id], value] of await entries('stats')) {
        if (STATS_KINDS.includes(kind as StatsKind) && typeof id === 'string' && isStat(value)) stats[kind as StatsKind][id] = value
      }
      out.stats = stats
    }
    if (stores.includes('best')) {
      out.best = {}
      for (const [[, key], value] of await entries('best')) if (typeof key === 'string' && isBest(value)) out.best[key] = value
    }
    if (stores.includes('runs')) {
      out.runs = (await entries('runs')).map(([, v]) => v).filter(isRun).sort((a, b) => a.date.localeCompare(b.date))
    }
    if (stores.includes('daily')) {
      out.daily = {}
      for (const [[, day], value] of await entries('daily')) if (isDayKey(day) && isDaily(value)) out.daily[day] = value
    }
    if (stores.includes('attempts')) {
      out.attempts = {}
      for (const [[, day], value] of await entries('attempts')) if (isDayKey(day) && isAttempt(value)) out.attempts[day] = value
    }
    return out
  })
}

/** The map's reset generation, read inside a transaction that includes `meta`. */
async function generationIn(tx: IDBTransaction, datasetId: string): Promise<number> {
  const g = await request(tx.objectStore('meta').get([datasetId, 'generation']))
  return isCount(g) ? g : 0
}

/**
 * Loads a map's progress into memory; call (and wait) before showing the map. Opens the database the
 * first time, and moves any progress an older version kept in localStorage into it.
 */
export async function openProgress(datasetId: string): Promise<void> {
  const db = await getDb()
  if (!db) {
    if (!snapshots.has(datasetId)) snapshots.set(datasetId, emptySnapshot())
  } else {
    await moveFromLocalStorage(db, datasetId).catch((e: unknown) => console.warn('Couldn’t move saved progress:', e))
    snapshots.set(datasetId, { ...emptySnapshot(), ...(await readStores(db, datasetId, PROGRESS_STORES)) })
  }
  changed()
}

/**
 * Whether progress is being saved: `'yes'`; `'failing'` when the latest save didn't work (e.g. storage
 * is full); `'paused'` while the database isn't available (it may still become available, and nothing
 * has been changed meanwhile); or `'no'` once changes have been made in memory only, which this tab can
 * then never save.
 */
export function saving(): 'yes' | 'failing' | 'paused' | 'no' {
  return memoryOnly ? 'no' : !persistent ? 'paused' : failing ? 'failing' : 'yes'
}

// ----- Reading -----

/**
 * The map's reset generation: a number every reset increases. A quiz notes it when it starts and
 * passes it with every change it saves; a change from before a reset (e.g. by a quiz left running in
 * another tab) is refused, so a reset can't be partly undone by old runs.
 */
export function progressGeneration(datasetId: string): number {
  return snap(datasetId).generation
}

export function loadStats(datasetId: string, kind: StatsKind = 'place'): Stats {
  return snap(datasetId).stats[kind]
}

/** Adds up per-place stats, e.g. map quizzes plus the Capitals quiz. */
export function combineStats(...all: Stats[]): Stats {
  const out: Stats = {}
  for (const stats of all) {
    for (const [id, s] of Object.entries(stats)) {
      const o = out[id] ?? { seen: 0, firstTry: 0 }
      out[id] = { seen: o.seen + s.seen, firstTry: o.firstTry + s.firstTry }
    }
  }
  return out
}

/** 0–1 share of first-try answers, or null if never quizzed. */
export function mastery(stat: PlaceStat | undefined): number | null {
  return stat && stat.seen > 0 ? stat.firstTry / stat.seen : null
}

/** Oldest first. */
export function loadRuns(datasetId: string): RunRecord[] {
  return snap(datasetId).runs
}

export function loadBest(datasetId: string, key: string): Best | undefined {
  return snap(datasetId).best[key]
}

/** Every best score for a map, keyed by "mode:group" (e.g. "find:Northeast"). */
export function loadAllBest(datasetId: string): Record<string, Best> {
  return snap(datasetId).best
}

/** Finished daily challenges, keyed by "YYYY-MM-DD". */
export function loadDaily(datasetId: string): Record<string, DailyRecord> {
  return snap(datasetId).daily
}

/** The day's challenge in progress, if one was started and not finished. */
export function loadAttempt(datasetId: string, day: string): DailyAttempt | undefined {
  return snap(datasetId).attempts[day]
}

/** True if there are any stats, best scores, history or daily results (finished or in progress) to reset. */
export function hasProgress(datasetId: string): boolean {
  const s = snap(datasetId)
  return (
    STATS_KINDS.some((k) => Object.keys(s.stats[k]).length > 0) ||
    Object.keys(s.best).length > 0 ||
    s.runs.length > 0 ||
    Object.keys(s.daily).length > 0 ||
    Object.keys(s.attempts).length > 0
  )
}

// ----- Writing: each change is one transaction, read and written together -----
//
// Every change takes the reset generation its quiz started in, and checks it in the same transaction
// as the change, so nothing from before a reset is saved after it.

type Committed<T> = { ok: true; value: T } | { ok: false }

/**
 * Saves a change in one transaction. If it fails (e.g. storage is full), that's recorded for `saving`,
 * so the app shows it, and `{ ok: false }` comes back for the caller to handle. Once committed, other
 * tabs are told straight away, and the given stores are re-read into memory here; that's separate (and
 * retried), so if it fails the change still counts as saved, and other tabs still see it.
 */
async function commit<T>(
  db: IDBDatabase,
  datasetId: string,
  stores: StoreName[],
  body: (tx: IDBTransaction) => Promise<T>,
  refreshStores: StoreName[],
): Promise<Committed<T>> {
  let value: T
  try {
    value = await transact(db, stores, 'readwrite', body)
  } catch (e) {
    console.warn('Couldn’t save progress:', e)
    if (!failing) {
      failing = true
      changed()
    }
    return { ok: false }
  }
  if (failing) {
    failing = false
    changed()
  }
  publish(datasetId, refreshStores)
  await refresh(datasetId, refreshStores)
  return { ok: true, value }
}

/** Applies a change to the in-memory copy only (when IndexedDB is unavailable), if no reset since. */
function changeInMemory(datasetId: string, generation: number, change: (s: Snapshot) => Snapshot): boolean {
  if (snap(datasetId).generation !== generation) return false
  memoryOnly = true
  snapshots.set(datasetId, change(snap(datasetId)))
  changed()
  return true
}

/** Counts one answer: seen, and whether it was right on the first try. */
export function recordAnswer(datasetId: string, placeId: string, firstTry: boolean, kind: StatsKind, generation: number) {
  const add = (s: PlaceStat | undefined): PlaceStat => ({ seen: (s?.seen ?? 0) + 1, firstTry: (s?.firstTry ?? 0) + (firstTry ? 1 : 0) })
  const save = async () => {
    const db = await getDb()
    if (!db) {
      changeInMemory(datasetId, generation, (s) => ({
        ...s,
        stats: { ...s.stats, [kind]: { ...s.stats[kind], [placeId]: add(s.stats[kind][placeId]) } },
      }))
      return
    }
    await commit(
      db,
      datasetId,
      ['stats', 'meta'],
      async (tx) => {
        if ((await generationIn(tx, datasetId)) !== generation) return
        const store = tx.objectStore('stats')
        const key = [datasetId, kind, placeId]
        const prev = await request(store.get(key))
        store.put(add(isStat(prev) ? prev : undefined), key)
      },
      ['stats'],
    )
  }
  void save()
}

/**
 * Saves the result if it beats the previous best (more correct, then faster). A previous best over a
 * different number of places (the region has since gained or lost places) is out of date, so any
 * result replaces it. Resolves true only if it was a new best AND it was actually saved — so the app
 * never claims a best it didn't keep.
 */
export async function saveBest(datasetId: string, key: string, result: Best, generation: number): Promise<boolean> {
  const beats = (prev: Best | undefined) =>
    !prev ||
    prev.total !== result.total ||
    result.correct > prev.correct ||
    (result.correct === prev.correct && result.ms < prev.ms)
  const db = await getDb()
  if (!db) {
    if (beats(snap(datasetId).best[key])) changeInMemory(datasetId, generation, (s) => ({ ...s, best: { ...s.best, [key]: result } }))
    return false // kept for now, but not saved
  }
  const better = await commit(
    db,
    datasetId,
    ['best', 'meta'],
    async (tx) => {
      if ((await generationIn(tx, datasetId)) !== generation) return false
      const store = tx.objectStore('best')
      const prev = await request(store.get([datasetId, key]))
      if (!beats(isBest(prev) ? prev : undefined)) return false
      store.put(result, [datasetId, key])
      return true
    },
    ['best'],
  )
  return better.ok && better.value
}

/** Adds a finished run to history, dropping the oldest beyond MAX_RUNS. */
export async function saveRun(datasetId: string, run: Omit<RunRecord, 'id' | 'date'>, generation: number): Promise<void> {
  const now = new Date()
  // Ids sort in time order; the random part keeps them unique when two tabs finish in the same millisecond.
  const entry: RunRecord = { ...run, id: `r_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`, date: now.toISOString() }
  const db = await getDb()
  if (!db) {
    changeInMemory(datasetId, generation, (s) => ({ ...s, runs: [...s.runs, entry].slice(-MAX_RUNS) }))
    return
  }
  await commit(
    db,
    datasetId,
    ['runs', 'meta'],
    async (tx) => {
      if ((await generationIn(tx, datasetId)) !== generation) return
      const store = tx.objectStore('runs')
      store.add(entry, [datasetId, entry.id])
      const extra = (await request(store.count(datasetRange(datasetId)))) - MAX_RUNS
      if (extra > 0) for (const key of await request(store.getAllKeys(datasetRange(datasetId), extra))) store.delete(key)
    },
    ['runs'],
  )
}

/**
 * Starts the day's challenge in this tab, or continues it from where it got to (after a reload, or
 * from another tab, which then stops accepting answers). Resolves to the attempt to play, or null if the
 * day already has a result, progress was reset since `generation` (the caller is out of date), or it
 * couldn't be saved (which the app then shows; see `saving`).
 */
export async function beginAttempt(
  datasetId: string,
  day: string,
  ids: string[],
  owner: string,
  generation: number,
): Promise<DailyAttempt | null> {
  const fresh: DailyAttempt = { ids, results: {}, mistakes: 0, ms: 0, owner }
  const db = await getDb()
  if (!db) {
    if (snap(datasetId).daily[day]) return null
    const attempt = { ...(snap(datasetId).attempts[day] ?? fresh), owner }
    return changeInMemory(datasetId, generation, (s) => ({ ...s, attempts: { ...s.attempts, [day]: attempt } })) ? attempt : null
  }
  // Refreshes both stores either way, to show what's there now: the attempt, or a result that's appeared.
  const attempt = await commit(
    db,
    datasetId,
    ['daily', 'attempts', 'meta'],
    async (tx) => {
      if ((await generationIn(tx, datasetId)) !== generation) return null
      // Finished meanwhile (e.g. in another tab whose result hasn't reached this one yet): nothing to play.
      if (isDaily(await request(tx.objectStore('daily').get([datasetId, day])))) return null
      const store = tx.objectStore('attempts')
      const prev = await request(store.get([datasetId, day]))
      const next = { ...(isAttempt(prev) ? prev : fresh), owner }
      store.put(next, [datasetId, day])
      return next
    },
    ['daily', 'attempts'],
  )
  return attempt.ok ? attempt.value : null
}

/**
 * How saving a daily attempt's progress went. `taken-over`: another tab has it now (or it's gone,
 * finished elsewhere); `stale`: progress was reset since it began. Either way this tab should stop
 * playing it. `failed` (e.g. storage is full) isn't a refusal: play goes on, and the app shows that
 * progress isn't being saved (see `saving`).
 */
export type AttemptSave = 'saved' | 'taken-over' | 'stale' | 'failed'

/** Saves where the day's challenge has got to, if it's still this tab's to play. */
export async function saveAttempt(
  datasetId: string,
  day: string,
  owner: string,
  progress: AttemptProgress,
  generation: number,
): Promise<AttemptSave> {
  const db = await getDb()
  if (!db) {
    const s = snap(datasetId)
    if (s.generation !== generation) return 'stale'
    const prev = s.attempts[day]
    if (prev?.owner !== owner) return 'taken-over'
    changeInMemory(datasetId, generation, (m) => ({ ...m, attempts: { ...m.attempts, [day]: { ...prev, ...progress } } }))
    return 'saved'
  }
  const saved = await commit(
    db,
    datasetId,
    ['attempts', 'meta'],
    async (tx): Promise<AttemptSave> => {
      if ((await generationIn(tx, datasetId)) !== generation) return 'stale'
      const store = tx.objectStore('attempts')
      const prev = await request(store.get([datasetId, day]))
      if (!isAttempt(prev) || prev.owner !== owner) return 'taken-over'
      store.put({ ...prev, ...progress }, [datasetId, day])
      return 'saved'
    },
    ['attempts'],
  )
  return saved.ok ? saved.value : 'failed'
}

/**
 * Makes `record` the day's result, if it's still this tab's to finish. In one transaction: refused if
 * progress was reset since the attempt began, if the day already has a result (returned instead, so
 * the caller can show it), or if another tab has since taken the attempt over; otherwise the result is
 * added and the attempt in progress removed together.
 */
export async function claimDaily(
  datasetId: string,
  day: string,
  record: DailyRecord,
  owner: string,
  generation: number,
): Promise<DailyClaim> {
  const db = await getDb()
  if (!db) {
    const s = snap(datasetId)
    if (s.generation !== generation) return { status: 'stale', record, stored: false }
    if (s.daily[day]) return { status: 'already-played', record: s.daily[day], stored: false }
    if (s.attempts[day]?.owner !== owner) return { status: 'taken-over', record, stored: false }
    changeInMemory(datasetId, generation, (prev) => {
      const { [day]: _done, ...attempts } = prev.attempts
      return { ...prev, daily: { ...prev.daily, [day]: record }, attempts }
    })
    return { status: 'failed', record, stored: false }
  }
  const claimed = await commit(
    db,
    datasetId,
    ['daily', 'attempts', 'meta'],
    async (tx): Promise<DailyClaim> => {
      if ((await generationIn(tx, datasetId)) !== generation) return { status: 'stale', record, stored: false }
      const key = [datasetId, day]
      const daily = tx.objectStore('daily')
      const attempts = tx.objectStore('attempts')
      const existing = await request(daily.get(key))
      if (isDaily(existing)) {
        attempts.delete(key) // any attempt still around for a finished day is left over
        return { status: 'already-played', record: existing, stored: true }
      }
      const attempt = await request(attempts.get(key))
      if (!isAttempt(attempt) || attempt.owner !== owner) return { status: 'taken-over', record, stored: false }
      daily.put(record, key)
      attempts.delete(key)
      return { status: 'saved', record, stored: true }
    },
    ['daily', 'attempts'],
  )
  return claimed.ok ? claimed.value : { status: 'failed', record, stored: false }
}

/**
 * The reset itself: clears a map's progress and moves it to the next generation, in one transaction.
 * The next generation is past both the saved one and this tab's: they can differ (a reset done in
 * memory only moves this tab's on but not the saved one), and reusing this tab's would let a quiz
 * already running with it keep saving after the reset.
 */
function clearIn(database: IDBDatabase, datasetId: string): Promise<number> {
  return transact(database, [...PROGRESS_STORES, 'meta'], 'readwrite', async (tx) => {
    const next = Math.max(await generationIn(tx, datasetId), snap(datasetId).generation) + 1
    for (const name of PROGRESS_STORES) tx.objectStore(name).delete(datasetRange(datasetId))
    tx.objectStore('meta').put(next, [datasetId, 'generation'])
    return next
  })
}

/**
 * Clears all saved progress for a map in one transaction, and moves it to a new generation, so no
 * change from before it — even one still on its way from a quiz in another tab — is saved after it.
 * Resolves false if the saved progress couldn't be cleared.
 *
 * A tab keeping progress in memory (see `memoryOnly`) still clears the saved progress: a reset only
 * removes, so it can't overwrite anything done meanwhile. It opens the database just for this (if it
 * opens within the usual wait), then clears its own copy either way.
 */
export async function resetProgress(datasetId: string): Promise<boolean> {
  const db = await getDb()
  if (!db) {
    let generation: number | null = null
    try {
      const once = openDb()
      const opened = await Promise.race([once, new Promise<null>((r) => setTimeout(() => r(null), BLOCKED_WAIT_MS))])
      // Opened too late: close it whenever it does open, rather than leave it holding the database.
      if (!opened) once.then((late) => late.close(), () => {})
      else {
        try {
          generation = await clearIn(opened, datasetId)
        } finally {
          opened.close()
        }
      }
    } catch (e) {
      console.warn('Couldn’t reset saved progress:', e)
    }
    // This tab's copy is cleared either way. Without the saved progress cleared too, the tab can only
    // carry on in memory (and says so), and the reset is reported as not done — unless the browser has
    // no IndexedDB at all, so nothing was ever saved and clearing this copy is the whole reset.
    if (generation === null) memoryOnly = true
    if (typeof indexedDB === 'undefined') {
      snapshots.set(datasetId, emptySnapshot(snap(datasetId).generation + 1))
      changed()
      return true
    }
    snapshots.set(datasetId, emptySnapshot(generation ?? snap(datasetId).generation + 1))
    // Cleared for real: the empty copy here is exactly what's saved, so nothing shown is out of date.
    if (generation !== null) outOfDate.delete(datasetId)
    changed()
    if (generation !== null) publish(datasetId, PROGRESS_STORES)
    return generation !== null
  }
  let generation: number
  try {
    generation = await clearIn(db, datasetId)
  } catch (e) {
    console.warn('Couldn’t reset progress:', e)
    return false // shown by the Reset button itself
  }
  // Cleared, so what's saved is now exactly an empty map at the new generation: show that here and
  // tell the other tabs straight away, without depending on reading it back.
  snapshots.set(datasetId, emptySnapshot(generation))
  outOfDate.delete(datasetId) // nothing shown is out of date: the empty copy here is exactly what's saved
  changed()
  publish(datasetId, PROGRESS_STORES)
  return true
}

// ----- Moving progress saved by older versions (in localStorage) into IndexedDB, once -----

const legacyKeys = (datasetId: string) => ({
  stats: `map-memory:${datasetId}:stats`,
  capitalStats: `map-memory:${datasetId}:capital-stats`,
  best: `map-memory:${datasetId}:best`,
  runs: `map-memory:${datasetId}:runs`,
  /** All days in one object (an early version), then one key per day */
  daily: `map-memory:${datasetId}:daily`,
  dailyPrefix: `map-memory:${datasetId}:daily:`,
})

function readLegacy(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    return text === null ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

const entriesOf = <T>(v: unknown, keep: (x: unknown) => x is T): [string, T][] =>
  isRecord(v) ? Object.entries(v).filter((e): e is [string, T] => keep(e[1])) : []

function legacyDailyKeys(prefix: string): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
      (k): k is string => k !== null && k.startsWith(prefix),
    )
  } catch {
    return []
  }
}

/**
 * Copies a map's localStorage progress into IndexedDB in one transaction, marked as done so it only
 * ever happens once (even with several tabs opening at the same time), then removes the old copies.
 */
async function moveFromLocalStorage(database: IDBDatabase, datasetId: string): Promise<void> {
  const k = legacyKeys(datasetId)
  const dayKeys = legacyDailyKeys(k.dailyPrefix)
  // The all-days object came first and per-day keys later, so a day in both takes its per-day value.
  const daily = new Map<string, DailyRecord>(entriesOf(readLegacy(k.daily), isDaily))
  for (const key of dayKeys) {
    const record = readLegacy(key)
    if (isDaily(record)) daily.set(key.slice(k.dailyPrefix.length), record)
  }
  for (const day of daily.keys()) if (!isDayKey(day)) daily.delete(day)
  const runs = (Array.isArray(readLegacy(k.runs)) ? (readLegacy(k.runs) as unknown[]) : []).filter(isRun)

  const moved = await transact(database, [...PROGRESS_STORES, 'meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta')
    if (await request(meta.get([datasetId, 'moved-from-localStorage']))) return false
    const stats = tx.objectStore('stats')
    for (const [id, s] of entriesOf(readLegacy(k.stats), isStat)) stats.put(s, [datasetId, 'place', id])
    for (const [id, s] of entriesOf(readLegacy(k.capitalStats), isStat)) stats.put(s, [datasetId, 'capital', id])
    const best = tx.objectStore('best')
    for (const [key, b] of entriesOf(readLegacy(k.best), isBest)) best.put(b, [datasetId, key])
    const runStore = tx.objectStore('runs')
    for (const run of runs.slice(-MAX_RUNS)) runStore.put(run, [datasetId, run.id])
    // A day already in IndexedDB (decided there by an earlier version) is the authoritative one.
    const dailyStore = tx.objectStore('daily')
    for (const [day, record] of daily) {
      if ((await request(dailyStore.count([datasetId, day]))) === 0) dailyStore.put(record, [datasetId, day])
    }
    meta.put(true, [datasetId, 'moved-from-localStorage'])
    return true
  })
  if (!moved) return
  try {
    for (const key of [k.stats, k.capitalStats, k.best, k.runs, k.daily, ...dayKeys]) localStorage.removeItem(key)
  } catch {
    // Left behind; harmless, since they're never read again.
  }
}
