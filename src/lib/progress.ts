/** Per-place learning stats, best scores and quiz history, kept in localStorage and namespaced by dataset. */
import type { Result } from '../modes/useQuizRun'

export type PlaceStat = { seen: number; firstTry: number }
export type Stats = Record<string, PlaceStat>
export type Best = { correct: number; total: number; ms: number }

const statsKey = (datasetId: string) => `map-memory:${datasetId}:stats`
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

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private mode etc.) — progress just won't persist.
  }
}

export function loadStats(datasetId: string): Stats {
  return read<Stats>(statsKey(datasetId), {})
}

export function recordAnswer(datasetId: string, placeId: string, firstTry: boolean) {
  const stats = loadStats(datasetId)
  const s = stats[placeId] ?? { seen: 0, firstTry: 0 }
  stats[placeId] = { seen: s.seen + 1, firstTry: s.firstTry + (firstTry ? 1 : 0) }
  write(statsKey(datasetId), stats)
}

/** Oldest first. */
export function loadRuns(datasetId: string): RunRecord[] {
  return read<RunRecord[]>(runsKey(datasetId), [])
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
    Object.keys(read(bestKey(datasetId), {})).length > 0 ||
    loadRuns(datasetId).length > 0
  )
}

export function resetProgress(datasetId: string) {
  write(statsKey(datasetId), {})
  write(bestKey(datasetId), {})
  write(runsKey(datasetId), [])
}

/** 0–1 share of first-try answers, or null if never quizzed. */
export function mastery(stat: PlaceStat | undefined): number | null {
  return stat && stat.seen > 0 ? stat.firstTry / stat.seen : null
}

export function loadBest(datasetId: string, key: string): Best | undefined {
  return read<Record<string, Best>>(bestKey(datasetId), {})[key]
}

/** Saves the result if it beats the previous best (more correct, then faster). Returns true if it did. */
export function saveBest(datasetId: string, key: string, result: Best): boolean {
  const all = read<Record<string, Best>>(bestKey(datasetId), {})
  const prev = all[key]
  const better =
    !prev || result.correct > prev.correct || (result.correct === prev.correct && result.ms < prev.ms)
  if (better) {
    all[key] = result
    write(bestKey(datasetId), all)
  }
  return better
}
