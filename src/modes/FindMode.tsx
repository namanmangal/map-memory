import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { playSound } from '../lib/sound'
import { shuffle } from '../lib/util'
import { QuizShell, type Ask, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun, type Result } from './useQuizRun'

/** "Click on Ohio" — find the named place on the map. */
export function FindMode({ active }: ModeProps) {
  return <QuizShell mode="find" active={active} render={(props) => <FindGame {...props} />} />
}

/**
 * Click the place on the map that matches the prompt: its name ("Click on Ohio") or its capital.
 * Also used as the "On the map" style of the Capitals quiz.
 */
export function FindGame({
  ids,
  focusIds,
  bestKey,
  onRestart,
  active,
  autoStart,
  meta,
  onFinish,
  hooks,
  ask = 'name',
  styleToggle,
  inOrder = false,
  pickFrom,
}: GameProps & {
  ask?: Ask
  styleToggle?: ReactNode
  /** Ask in the order given instead of shuffling (the daily challenge's order is the same for everyone) */
  inOrder?: boolean
  /** Places that can be clicked, if more than the ones asked (the daily challenge uses the whole map) */
  pickFrom?: string[]
}) {
  const ds = useDataset()
  const [queue] = useState(() => (inOrder ? ids : shuffle(ids)))
  const { started, begin, paused, pauseReason, pause, resume, live, running, results, resolve, finish, elapsed, done } = useQuizRun(
    ids,
    bestKey,
    active,
    autoStart,
    meta,
    onFinish,
    hooks,
  )
  const [mistakes, setMistakes] = useState(() => hooks?.resume?.mistakes ?? 0)
  const [wrongId, setWrongId] = useState<string | null>(null)
  // Bumped on every wrong click, so clicking the same wrong state again restarts its feedback.
  const [wrongClicks, setWrongClicks] = useState(0)

  const current = queue.find((id) => !results[id])
  const nameAndCapital = (id: string) => `${ds.byId[id].name}\nCapital: ${ds.byId[id].capital}`
  const revealed = mistakes >= MAX_ATTEMPTS

  useEffect(() => {
    if (!wrongId) return
    const t = setTimeout(() => setWrongId(null), 900)
    return () => clearTimeout(t)
  }, [wrongId, wrongClicks])

  /** Reports where the run has got to (for the daily challenge, which saves it so a reload continues it). */
  const report = (nextResults: Record<string, Result>, nextMistakes: number) =>
    hooks?.onProgress?.({ results: nextResults, mistakes: nextMistakes, ms: elapsed() })
  // Pausing (including by leaving the window) saves the time so far too. Through a ref holding the
  // latest state, so the effect runs only when pausing, not on every answer.
  const reportNow = useRef(() => {})
  useEffect(() => {
    reportNow.current = () => report(results, mistakes)
  })
  useEffect(() => {
    if (paused) reportNow.current()
  }, [paused])
  // While running, the time is saved every few seconds too, so reloading can't hide time spent looking
  // at a question (it would otherwise only be saved at the next answer).
  const saving = Boolean(hooks?.onProgress)
  useEffect(() => {
    if (!saving || !running) return
    const t = setInterval(() => reportNow.current(), 3000)
    return () => clearInterval(t)
  }, [saving, running])

  const pick = (id: string) => {
    if (!live || !current || results[id]) return
    if (id === current) {
      // No chime for clicking the flashing answer after three misses.
      if (!revealed) playSound('correct')
      const result = resultFor(mistakes)
      resolve(current, result)
      setMistakes(0)
      setWrongId(null)
      // The last answer isn't reported: finishing saves the result (and clears the saved progress).
      const next = { ...results, [current]: result }
      if (Object.keys(next).length < ids.length) report(next, 0)
    } else if (!revealed) {
      playSound('wrong')
      report(results, mistakes + 1)
      setMistakes((m) => m + 1)
      setWrongId(id)
      setWrongClicks((n) => n + 1)
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
          <QuizStart count={ids.length} onStart={begin}>
            {styleToggle}
          </QuizStart>
        ) : paused ? (
          <QuizPaused elapsed={elapsed()} reason={pauseReason} onResume={resume}>
            {styleToggle}
          </QuizPaused>
        ) : finish ? (
          styleToggle
        ) : current ? (
          <>
            <span className="muted">
              {done + 1} of {ids.length}
            </span>
            <span className="ask">
              {ask === 'capital' ? (
                <>
                  Click the {ds.config.noun.one} whose capital is <strong>{ds.byId[current].capital}</strong>
                </>
              ) : (
                <>
                  Click on <strong>{ds.byId[current].name}</strong>
                </>
              )}
            </span>
            <span className="feedback">
              {wrongId &&
                !revealed &&
                (ask === 'capital'
                  ? `That's ${ds.byId[wrongId].name} — its capital is ${ds.byId[wrongId].capital}`
                  : `That's ${ds.byId[wrongId].name}`)}
              {revealed && `It's flashing — click it to continue`}
              {!wrongId && !revealed && mistakes > 0 && `${MAX_ATTEMPTS - mistakes} ${MAX_ATTEMPTS - mistakes === 1 ? 'try' : 'tries'} left`}
            </span>
            {/* Right before the timer, so both sit together at the right like Name it's */}
            {styleToggle}
            <QuizTimer elapsed={elapsed} running={running} onPause={pause} />
          </>
        ) : null}
      </div>
      <MapView
        activeIds={new Set(pickFrom ?? ids)}
        focusIds={focusIds}
        zoomable
        classFor={classFor}
        labelFor={(id) => (results[id] ? ds.byId[id].code : undefined)}
        tooltipFor={(id) => (results[id] ? (ask === 'capital' ? nameAndCapital(id) : ds.byId[id].name) : undefined)}
        onPick={pick}
        // Keyboard buttons only while a question is live: unanswered states, or just the answer once revealed.
        canPick={(id) => live && !finish && !!current && !results[id] && (!revealed || id === current)}
        // Names would give the answer away, so only states already found are named.
        ariaLabelFor={(id) => (results[id] ? `${ds.byId[id].name} (found)` : 'Unanswered state')}
      />
      <ResultLegend />
      {finish && <Summary ids={ids} results={results} finish={finish} onRestart={onRestart} />}
    </div>
  )
}
