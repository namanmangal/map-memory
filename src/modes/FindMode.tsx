import { useEffect, useState } from 'react'
import { useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { shuffle } from '../lib/util'
import { QuizShell, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

/** "Click on Ohio" — find the named place on the map. */
export function FindMode({ active }: ModeProps) {
  return <QuizShell mode="find" active={active} render={(props) => <FindGame {...props} />} />
}

function FindGame({ ids, focusIds, bestKey, onRestart, active, autoStart, meta }: GameProps) {
  const ds = useDataset()
  const [queue] = useState(() => shuffle(ids))
  const { started, begin, paused, pauseReason, pause, resume, live, running, results, resolve, finish, elapsed, done } = useQuizRun(
    ids,
    bestKey,
    active,
    autoStart,
    meta,
  )
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
    if (!live || !current || results[id]) return
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
    if (!started) return undefined
    // While paused, keep answered states colored but don't give away the current one.
    if (paused) return results[id]
    if (results[id]) return results[id]
    if (id === wrongId) return 'wrong'
    if (revealed && id === current) return 'pulse'
    return 'hoverable'
  }

  return (
    <div className="game">
      <div className="prompt" aria-live="polite">
        {!started ? (
          <QuizStart count={ids.length} onStart={begin} />
        ) : paused ? (
          <QuizPaused elapsed={elapsed()} reason={pauseReason} onResume={resume} />
        ) : finish ? null : current ? (
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
            <QuizTimer elapsed={elapsed} running={running} onPause={pause} />
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
