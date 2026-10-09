import { useEffect, useRef, useState } from 'react'
import { useDataset } from '../datasets/dataset'
import { recordAnswer, saveBest, saveRun, type RunMeta } from '../lib/progress'

/** How many tries it took; `missed` means the answer had to be shown. */
export type Result = 'first' | 'second' | 'third' | 'missed'

export const RESULTS: { id: Result; label: string }[] = [
  { id: 'first', label: '1st try' },
  { id: 'second', label: '2nd try' },
  { id: 'third', label: '3rd try' },
  { id: 'missed', label: "Didn't get" },
]

export const MAX_ATTEMPTS = 3

export function resultFor(mistakes: number): Result {
  return mistakes >= MAX_ATTEMPTS ? 'missed' : RESULTS[mistakes].id
}

export const pct = (n: number, total: number) => Math.round((n / total) * 100)

/** First-try and within-three-tries percentages for a run. */
export function scoreOf(ids: string[], results: Record<string, Result>) {
  const first = ids.filter((id) => results[id] === 'first').length
  const missed = ids.filter((id) => results[id] === 'missed').length
  return { first, total: ids.length, firstPct: pct(first, ids.length), gotPct: pct(ids.length - missed, ids.length) }
}

export type Finish = { ms: number; newBest: boolean }

/** `user` = pressed Pause; `left` = switched away from the browser window */
export type PauseReason = 'user' | 'left'

/** Tracks one run through a set of places: results, timing, stats and best score. */
export function useQuizRun(
  ids: string[],
  bestKey: string | undefined,
  active: boolean,
  autoStart: boolean,
  meta: RunMeta,
) {
  const ds = useDataset()
  // The clock only starts when the user starts the quiz (or asked to by restarting).
  const [start, setStart] = useState<number | null>(() => (autoStart ? Date.now() : null))
  const begin = () => setStart(Date.now())

  const [results, setResults] = useState<Record<string, Result>>({})
  const [finish, setFinish] = useState<Finish | null>(null)

  // Pausing (by the user, or by leaving the browser window) holds the run until the user chooses to resume.
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null)
  const paused = pauseReason !== null
  const pause = () => setPauseReason('user')
  const resume = () => setPauseReason(null)
  const running = start !== null && !finish && active && !paused

  // Only time while running counts: not on other tabs, and not while paused.
  const pausedAt = useRef<number | null>(null)
  const pausedTotal = useRef(0)
  useEffect(() => {
    if (start === null) return
    if (!running) {
      if (pausedAt.current === null) pausedAt.current = Date.now()
    } else if (pausedAt.current !== null) {
      pausedTotal.current += Date.now() - pausedAt.current
      pausedAt.current = null
    }
  }, [running, start])

  useEffect(() => {
    if (!running) return
    const left = () => setPauseReason('left')
    const onVisibility = () => document.hidden && left()
    window.addEventListener('blur', left)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', left)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [running])

  const resolve = (id: string, result: Result) => {
    if (start === null || paused || results[id]) return
    const next = { ...results, [id]: result }
    setResults(next)
    recordAnswer(ds.config.id, id, result === 'first')

    if (Object.keys(next).length === ids.length) {
      const ms = Date.now() - start - pausedTotal.current
      const correct = Object.values(next).filter((r) => r === 'first').length
      const newBest = bestKey ? saveBest(ds.config.id, bestKey, { correct, total: ids.length, ms }) : false
      saveRun(ds.config.id, { ...meta, ms, results: next })
      setFinish({ ms, newBest })
    }
  }

  /** Milliseconds so far, not counting time spent on other tabs */
  const elapsed = () => {
    if (finish) return finish.ms
    if (start === null) return 0
    const now = Date.now()
    return now - start - pausedTotal.current - (pausedAt.current !== null ? now - pausedAt.current : 0)
  }

  return {
    started: start !== null,
    begin,
    paused,
    pauseReason,
    pause,
    resume,
    /** Started and not paused: the question is showing and can be answered */
    live: start !== null && !paused,
    running,
    results,
    resolve,
    finish,
    elapsed,
    done: Object.keys(results).length,
  }
}
