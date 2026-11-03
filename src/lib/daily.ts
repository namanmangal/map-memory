/** The daily challenge: the same places, in the same order, for everyone on a given day. */
import type { Result } from '../modes/useQuizRun'

/** How many places a daily challenge asks (fewer if the map is smaller). */
export const DAILY_COUNT = 10

/** Today's date as "YYYY-MM-DD" in the viewer's own time zone, so a new challenge starts at their midnight. */
export function dateKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The day before a "YYYY-MM-DD" key (local calendar days, so daylight-saving changes don't matter). */
function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d - 1))
}

/** FNV-1a: turns the seed text into a 32-bit number. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: a small seeded random number generator, so every browser draws the same sequence. */
function seededRandom(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The day's places, in the order they're asked: a seeded shuffle of the map's places, so it depends
 * only on the map and the date. `ids` must be in the dataset's own order (not shuffled) for that.
 */
export function dailyIds(datasetId: string, ids: string[], key: string): string[] {
  const random = seededRandom(hash(`${datasetId}:${key}`))
  const a = [...ids]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, DAILY_COUNT)
}

/**
 * Days in a row with a finished challenge, ending today — or yesterday, if today's isn't played
 * yet, since the streak is still alive until today ends.
 */
export function streak(playedDays: Set<string>, today: string): number {
  let day = playedDays.has(today) ? today : previousDay(today)
  let n = 0
  while (playedDays.has(day)) {
    n++
    day = previousDay(day)
  }
  return n
}

const SQUARES: Record<Result, string> = { first: '🟩', second: '🟨', third: '🟧', missed: '🟥' }

/** One square per place, in the order asked: 🟩 1st try, 🟨 2nd, 🟧 3rd, 🟥 didn't get. */
export function resultSquares(ids: string[], results: Record<string, Result>): string {
  return ids.map((id) => SQUARES[results[id]] ?? '⬜').join('')
}

/** "5h 12m" (or "12m") until the viewer's next midnight, when the next challenge starts. */
export function timeUntilTomorrow(now = new Date()): string {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const minutes = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`
}
