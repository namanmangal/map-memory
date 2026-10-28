/** Per-place learning stats, best scores and quiz history, kept in localStorage and namespaced by dataset. */
import type { Result } from '../modes/useQuizRun'

export type PlaceStat = { seen: number; firstTry: number }
export type Stats = Record<string, PlaceStat>
export type Best = { correct: number; total: number; ms: number }

/** Map quizzes (find, name, drag) and the Capitals quiz keep separate per-place stats. */
export type StatsKind = 'place' | 'capital'
const statsKey = (datasetId: string, kind: StatsKind = 'place') =>
  kind === 'capital' ? `map-memory:${datasetId}:capital-stats` : `map-memory:${datasetId}:stats`
const bestKey = (datasetId: string) => `map-memory:${datasetId}:best`
const runsKey = (datasetId: string) => `map-memory:${datasetId}:runs`

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

/** A full 50-state run is ~1.5 KB, so this stays well inside localStorage's ~5 MB. */
const MAX_RUNS = 2000

// ----- Reading safely: stored data may be hand-edited, from an older version, or damaged -----

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Counts (answers seen, correct, total) are whole numbers. */
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
/** Durations in milliseconds may be fractional, but must be real, nonnegative numbers. */
const isDuration = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const RESULT_VALUES: Result[] = ['first', 'second', 'third', 'missed']

/** Keeps only the entries of an object that pass `keep`; anything that isn't an object becomes {}. */
function cleanRecord<T>(v: unknown, keep: (entry: unknown) => entry is T): Record<string, T> {
  if (!isRecord(v)) return {}
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, T] => keep(e[1])))
}

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

/** Reads and validates a stored value; anything unreadable or the wrong shape yields a safe default. */
function read<T>(key: string, clean: (raw: unknown) => T): T {
  let raw: unknown = undefined
  try {
    const text = localStorage.getItem(key)
    raw = text === null ? undefined : JSON.parse(text)
  } catch {
    // Unreadable (bad JSON or storage unavailable): treat as empty.
  }
  return clean(raw)
}

const cleanStats = (raw: unknown): Stats => cleanRecord(raw, isStat)
const cleanBest = (raw: unknown): Record<string, Best> => cleanRecord(raw, isBest)
const cleanRuns = (raw: unknown): RunRecord[] => (Array.isArray(raw) ? raw.filter(isRun) : [])

/** Returns false if the value couldn't be saved (storage full, private mode, etc.). */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadStats(datasetId: string, kind: StatsKind = 'place'): Stats {
  return read(statsKey(datasetId, kind), cleanStats)
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

export function recordAnswer(datasetId: string, placeId: string, firstTry: boolean, kind: StatsKind = 'place') {
  const stats = loadStats(datasetId, kind)
  const s = stats[placeId] ?? { seen: 0, firstTry: 0 }
  stats[placeId] = { seen: s.seen + 1, firstTry: s.firstTry + (firstTry ? 1 : 0) }
  write(statsKey(datasetId, kind), stats)
}

/** Oldest first. */
export function loadRuns(datasetId: string): RunRecord[] {
  return read(runsKey(datasetId), cleanRuns)
}

export function saveRun(datasetId: string, run: Omit<RunRecord, 'id' | 'date'>) {
  const now = new Date()
  let runs = [...loadRuns(datasetId), { ...run, id: `r_${now.getTime()}`, date: now.toISOString() }].slice(-MAX_RUNS)
  // If storage is full, drop the oldest runs until the new one fits.
  while (runs.length > 0) {
    try {
      localStorage.setItem(runsKey(datasetId), JSON.stringify(runs))
      return
    } catch {
      if (runs.length === 1) return // storage unavailable altogether
      runs = runs.slice(Math.ceil(runs.length / 4))
    }
  }
}

/** True if there are any stats, best scores or history to reset. */
export function hasProgress(datasetId: string): boolean {
  return (
    Object.keys(loadStats(datasetId)).length > 0 ||
    Object.keys(loadStats(datasetId, 'capital')).length > 0 ||
    Object.keys(read(bestKey(datasetId), cleanBest)).length > 0 ||
    loadRuns(datasetId).length > 0
  )
}

/** Clears all saved progress for a map. Returns false if any part couldn't be cleared. */
export function resetProgress(datasetId: string): boolean {
  const results = [
    write(statsKey(datasetId), {}),
    write(statsKey(datasetId, 'capital'), {}),
    write(bestKey(datasetId), {}),
    write(runsKey(datasetId), []),
  ]
  return results.every(Boolean)
}

/** 0–1 share of first-try answers, or null if never quizzed. */
export function mastery(stat: PlaceStat | undefined): number | null {
  return stat && stat.seen > 0 ? stat.firstTry / stat.seen : null
}

export function loadBest(datasetId: string, key: string): Best | undefined {
  return read(bestKey(datasetId), cleanBest)[key]
}

/**
 * Saves the result if it beats the previous best (more correct, then faster). Returns true only if
 * it was a new best AND it was actually saved — so the app never claims a best it didn't keep.
 */
export function saveBest(datasetId: string, key: string, result: Best): boolean {
  const all = read(bestKey(datasetId), cleanBest)
  const prev = all[key]
  const better =
    !prev || result.correct > prev.correct || (result.correct === prev.correct && result.ms < prev.ms)
  if (!better) return false
  all[key] = result
  return write(bestKey(datasetId), all)
}
