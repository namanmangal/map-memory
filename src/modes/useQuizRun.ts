import { useState } from 'react'
import { useDataset } from '../datasets/dataset'
import { recordAnswer, saveBest } from '../lib/progress'

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

export type Finish = { ms: number; newBest: boolean }

/** Tracks one run through a set of places: results, timing, stats and best score. */
export function useQuizRun(ids: string[], bestKey?: string) {
  const ds = useDataset()
  const [start] = useState(() => Date.now())
  const [results, setResults] = useState<Record<string, Result>>({})
  const [finish, setFinish] = useState<Finish | null>(null)

  const resolve = (id: string, result: Result) => {
    if (results[id]) return
    const next = { ...results, [id]: result }
    setResults(next)
    recordAnswer(ds.config.id, id, result === 'first')

    if (Object.keys(next).length === ids.length) {
      const ms = Date.now() - start
      const correct = Object.values(next).filter((r) => r === 'first').length
      const newBest = bestKey ? saveBest(ds.config.id, bestKey, { correct, total: ids.length, ms }) : false
      setFinish({ ms, newBest })
    }
  }

  return { results, resolve, finish, done: Object.keys(results).length }
}
