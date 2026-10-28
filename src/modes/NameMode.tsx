import { useMemo, useState, type FormEvent } from 'react'
import { useDataset, type LoadedDataset } from '../datasets/dataset'
import type { Place } from '../datasets/types'
import { MapView } from '../map/MapView'
import { playSound } from '../lib/sound'
import { levenshtein, normalize, shuffle } from '../lib/util'
import { QuizShell, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

type InputStyle = 'type' | 'choose'

const STYLES: InputStyle[] = ['type', 'choose']

/** What the quiz asks for about the highlighted place */
type Ask = 'name' | 'capital'

/** A place is highlighted — type or pick its name. */
export function NameMode(props: ModeProps) {
  return <AskQuiz {...props} ask="name" />
}

/** A place is highlighted and named — type or pick its capital. */
export function CapitalMode(props: ModeProps) {
  return <AskQuiz {...props} ask="capital" />
}

/**
 * Type and Choose are separate quizzes, each with its own region, progress, timer and best
 * score; both stay mounted so switching between them doesn't lose either run.
 */
function AskQuiz({ active, ask }: ModeProps & { ask: Ask }) {
  const [style, setStyle] = useState<InputStyle>('type')
  return (
    <>
      {STYLES.map((s) => (
        <div key={s} hidden={style !== s}>
          <QuizShell
            mode={`${ask}-${s}`}
            active={active && style === s}
            eligible={canAsk(ask)}
            render={(props) => <NameGame {...props} ask={ask} style={s} onStyle={setStyle} />}
          />
        </div>
      ))}
    </>
  )
}

/** Places this quiz can ask about: every place for names, only places with a capital for capitals. */
const canAsk = (ask: Ask) => (p: Place) => ask === 'name' || Boolean(p.capital)

/** Three wrong options drawn from the nearest neighbors, so the choice isn't trivial. */
function choicesFor(ds: LoadedDataset, id: string, ask: Ask): string[] {
  const nearby = ds.places
    .filter(canAsk(ask))
    .map((p) => p.id)
    .filter((other) => other !== id)
    .sort((a, b) => ds.distance(id, a) - ds.distance(id, b))
    .slice(0, 7)
  return shuffle([id, ...shuffle(nearby).slice(0, 3)])
}

type Check = 'right' | 'typo' | 'wrong'

/** "St. Paul" and "Saint Paul" count as the same answer. */
const canonical = (text: string) => normalize(text).replace(/\bst\b/g, 'saint')

/**
 * Exact (ignoring case, punctuation and "St."/"Saint") is right; one letter off is a forgiven typo
 * for answers of 4+ letters (so Ohio, Iowa, Utah, Boise count) — unless what was typed is exactly
 * another place's answer, which is a real mistake, not a typo.
 */
function checkTyped(answer: string, name: string, others: Set<string>, code?: string): Check {
  const a = canonical(answer)
  const n = canonical(name)
  if (a === n || (code && a === code.toLowerCase())) return 'right'
  if (n.length >= 4 && levenshtein(a, n) === 1 && !others.has(a)) return 'typo'
  return 'wrong'
}

function NameGame({
  ids,
  focusIds,
  bestKey,
  active,
  autoStart,
  meta,
  onFinish,
  onRestart,
  ask,
  style,
  onStyle,
}: GameProps & { ask: Ask; style: InputStyle; onStyle: (s: InputStyle) => void }) {
  const ds = useDataset()
  /** The answer for a place: its name, or its capital */
  const answerOf = (id: string) => (ask === 'capital' ? (ds.byId[id].capital ?? '') : ds.byId[id].name)
  const [queue] = useState(() => shuffle(ids))
  const { started, begin, paused, pauseReason, pause, resume, live, running, results, resolve, finish, elapsed, done } = useQuizRun(
    ids,
    bestKey,
    active,
    autoStart,
    meta,
    onFinish,
  )
  const [mistakes, setMistakes] = useState(0)
  const [wrongChoices, setWrongChoices] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')

  const current = queue.find((id) => !results[id])
  const revealed = mistakes >= MAX_ATTEMPTS
  const choices = useMemo(() => (current ? choicesFor(ds, current, ask) : []), [ds, current, ask])

  /** Moves to the next place. `note` is feedback carried over about the answer just given (e.g. "✓ Ohio"); nothing else from this place is. */
  const advance = (note = '') => {
    if (!current) return
    resolve(current, resultFor(mistakes))
    setMistakes(0)
    setWrongChoices([])
    setTyped('')
    setNote(note)
  }

  const miss = () => setMistakes((m) => m + 1)

  const choose = (id: string) => {
    if (!current || revealed) return
    if (id === current) {
      playSound('correct')
      advance(`✓ ${answerOf(current)}`)
    } else {
      playSound('wrong')
      setWrongChoices((w) => [...w, id])
      setNote('')
      miss()
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!current) return
    if (revealed) return advance()
    if (!typed.trim()) return
    const place = ds.byId[current]
    const answer = answerOf(current)
    // The state's abbreviation is accepted for its name, not for its capital.
    const others = new Set(ds.places.filter((p) => p.id !== current).map((p) => canonical(answerOf(p.id))))
    const result = checkTyped(typed, answer, others, ask === 'name' ? place.code : undefined)
    if (result === 'wrong') {
      playSound('wrong')
      setNote(`Not ${typed.trim()}`)
      setTyped('')
      miss()
    } else {
      playSound('correct')
      advance(result === 'typo' ? `✓ Close enough — it's spelled ${answer}` : `✓ ${answer}`)
    }
  }

  // Before starting, and while paused, don't highlight the current question.
  const classFor = (id: string) => (!started ? undefined : id === current && live ? 'target' : results[id])

  // Available before starting too, so you can pick how to answer first.
  const styleToggle = (
    <span className="segmented" role="group" aria-label="How to answer">
      <button className={style === 'type' ? 'on' : ''} aria-pressed={style === 'type'} onClick={() => onStyle('type')}>
        Type
      </button>
      <button className={style === 'choose' ? 'on' : ''} aria-pressed={style === 'choose'} onClick={() => onStyle('choose')}>
        Choose
      </button>
    </span>
  )

  return (
    <div className="game">
      <div className="prompt" aria-live="polite">
        {!started && (
          <QuizStart count={ids.length} onStart={begin}>
            {styleToggle}
          </QuizStart>
        )}
        {paused && (
          <QuizPaused elapsed={elapsed()} reason={pauseReason} onResume={resume}>
            {styleToggle}
          </QuizPaused>
        )}
        {/* After a finished run, keep the toggle so you can switch to the other style. */}
        {finish && styleToggle}
        {live && !finish && current && (
          <>
            <span className="muted">
              {done + 1} of {ids.length}
            </span>
            <span className="ask">
              {ask === 'capital' ? (
                <>
                  What's the capital of <strong>{ds.byId[current].name}</strong>?
                </>
              ) : (
                <>Which {ds.config.noun.one} is highlighted?</>
              )}
            </span>
            {styleToggle}
            <QuizTimer elapsed={elapsed} running={running} onPause={pause} />
          </>
        )}
      </div>

      {live && !finish && current && (
        <div className="answer">
          {style === 'choose' ? (
            <div className="choices">
              {choices.map((id) => (
                <button
                  key={id}
                  disabled={wrongChoices.includes(id) || revealed}
                  className={revealed && id === current ? 'reveal' : wrongChoices.includes(id) ? 'wrong' : ''}
                  onClick={() => choose(id)}
                >
                  {answerOf(id)}
                </button>
              ))}
            </div>
          ) : (
            <form className="type-form" onSubmit={submit}>
              <input
                autoFocus
                value={revealed ? answerOf(current) : typed}
                readOnly={revealed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={
                  ask === 'capital' ? 'Capital city' : `${ds.config.noun.one[0].toUpperCase()}${ds.config.noun.one.slice(1)} name`
                }
                aria-label="Your answer"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit">{revealed ? 'Next' : 'Check'}</button>
            </form>
          )}
          <div className="feedback">
            {revealed ? (
              <>
                It's <strong>{answerOf(current)}</strong>.{' '}
                {style === 'choose' && <button onClick={() => advance()}>Next</button>}
              </>
            ) : (
              <>
                {note}
                {mistakes > 0 && ` · ${MAX_ATTEMPTS - mistakes} tries left`}{' '}
                <button className="link" onClick={() => setMistakes(MAX_ATTEMPTS)}>
                  Show answer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <MapView
        activeIds={new Set(ids)}
        focusIds={focusIds}
        classFor={classFor}
        labelFor={(id) => (results[id] ? ds.byId[id].code : undefined)}
        tooltipFor={(id) =>
          results[id] ? (ask === 'capital' ? `${ds.byId[id].name}\nCapital: ${ds.byId[id].capital}` : ds.byId[id].name) : undefined
        }
      />
      <ResultLegend />
      {finish && <Summary ids={ids} results={results} finish={finish} onRestart={onRestart} />}
    </div>
  )
}
