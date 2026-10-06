import { useEffect, useState } from 'react'
import { useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { shuffle } from '../lib/util'
import { QuizShell, type GameProps } from './QuizShell'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

/** "Click on Ohio" — find the named place on the map. */
export function FindMode() {
  return <QuizShell mode="find" render={(props) => <FindGame {...props} />} />
}

function FindGame({ ids, focusIds, bestKey, onRestart }: GameProps) {
  const ds = useDataset()
  const [queue] = useState(() => shuffle(ids))
  const { results, resolve, finish, done } = useQuizRun(ids, bestKey)
  const [mistakes, setMistakes] = useState(0)
  const [wrongId, setWrongId] = useState<string | null>(null)

  const current = queue.find((id) => !results[id])
  const revealed = mistakes >= MAX_ATTEMPTS

  useEffect(() => {
    if (!wrongId) return
    const t = setTimeout(() => setWrongId(null), 900)
    return () => clearTimeout(t)
  }, [wrongId])

  const pick = (id: string) => {
    if (!current || results[id]) return
    if (id === current) {
      resolve(current, resultFor(mistakes))
      setMistakes(0)
      setWrongId(null)
    } else if (!revealed) {
      setMistakes((m) => m + 1)
      setWrongId(id)
    }
  }

  const classFor = (id: string) => {
    if (results[id]) return results[id]
    if (id === wrongId) return 'wrong'
    if (revealed && id === current) return 'pulse'
    return 'hoverable'
  }

  return (
    <div className="game">
      <div className="prompt" aria-live="polite">
        {finish ? null : current ? (
          <>
            <span className="muted">
              {done + 1} of {ids.length}
            </span>
            <span className="ask">
              Click on <strong>{ds.byId[current].name}</strong>
            </span>
            <span className="feedback">
              {wrongId && !revealed && `That's ${ds.byId[wrongId].name}`}
              {revealed && `It's flashing — click it to continue`}
              {!wrongId && !revealed && mistakes > 0 && `${MAX_ATTEMPTS - mistakes} tries left`}
            </span>
          </>
        ) : null}
      </div>
      <MapView
        activeIds={new Set(ids)}
        focusIds={focusIds}
        zoomable
        classFor={classFor}
        labelFor={(id) => (results[id] ? ds.byId[id].code : undefined)}
        tooltipFor={(id) => (results[id] ? ds.byId[id].name : undefined)}
        onPick={pick}
      />
      <ResultLegend />
      {finish && <Summary ids={ids} results={results} finish={finish} onRestart={onRestart} />}
    </div>
  )
}
