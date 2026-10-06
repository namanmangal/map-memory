/** Per-place learning stats and best scores, kept in localStorage and namespaced by dataset. */

export type PlaceStat = { seen: number; firstTry: number }
export type Stats = Record<string, PlaceStat>
export type Best = { correct: number; total: number; ms: number }

const statsKey = (datasetId: string) => `map-memory:${datasetId}:stats`
const bestKey = (datasetId: string) => `map-memory:${datasetId}:best`

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

export function resetProgress(datasetId: string) {
  write(statsKey(datasetId), {})
  write(bestKey(datasetId), {})
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
