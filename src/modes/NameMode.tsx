import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useDataset, type LoadedDataset } from '../datasets/dataset'
import type { Place } from '../datasets/types'
import { MapView } from '../map/MapView'
import { playSound } from '../lib/sound'
import { levenshtein, normalize, shuffle } from '../lib/util'
import { FindGame } from './FindMode'
import { QuizShell, type Ask, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

/** How to answer: type it, pick from four, or click the place on the map */
type InputStyle = 'type' | 'choose' | 'map'

const STYLE_LABELS: Record<InputStyle, string> = { type: 'Type', choose: 'Choose', map: 'On the map' }

/** Name it has no "On the map" style: that's what Find it is. */
const stylesFor = (ask: Ask): InputStyle[] => (ask === 'name' ? ['type', 'choose'] : ['type', 'choose', 'map'])

/** A place is highlighted — type or pick its name. */
export function NameMode(props: ModeProps) {
  return <AskQuiz {...props} ask="name" />
}

/** A place is highlighted and named — type or pick its capital; or click the place with a given capital. */
export function CapitalMode(props: ModeProps) {
  return <AskQuiz {...props} ask="capital" />
}


/**
 * Each answer style is a separate quiz, with its own region, progress, timer and best score; all
 * stay mounted so switching between them doesn't lose any run.
 */
function AskQuiz({ active, ask }: ModeProps & { ask: Ask }) {
  const [style, setStyle] = useState<InputStyle>('type')
  const styles = stylesFor(ask)
  // Shown in every style's prompt row, before starting too, so you can pick how to answer first.
  const styleToggle = (
    <span className="segmented" role="group" aria-label="How to answer">
      {styles.map((s) => (
        <button key={s} className={style === s ? 'on' : ''} aria-pressed={style === s} onClick={() => setStyle(s)}>
          {STYLE_LABELS[s]}
        </button>
      ))}
    </span>
  )
  return (
    <>
      {styles.map((s) => (
        <div key={s} hidden={style !== s}>
          <QuizShell
            mode={`${ask}-${s}`}
            active={active && style === s}
            eligible={canAsk(ask)}
            render={(props) =>
              s === 'map' ? (
                <FindGame {...props} ask={ask} styleToggle={styleToggle} />
              ) : (
                <NameGame {...props} ask={ask} style={s} styleToggle={styleToggle} />
              )
            }
          />
        </div>
      ))}
    </>
  )
}

/** Places this quiz can ask about: every place for names, only places with a capital for capitals. */
const canAsk = (ask: Ask) => (p: Place) => ask === 'name' || Boolean(p.capital)

/**
 * Three wrong options that are easy to confuse with the answer: places bordering it first, then
 * places bordering those, then (for islands, or places with few neighbors) the nearest others.
 * Each tier is shuffled, so the same place gets different options from run to run. Only places the
 * quiz can ask about are candidates, filtered before anything is cut, so there are always three
 * wrong options when the quiz has three other places to offer.
 */
function choicesFor(ds: LoadedDataset, id: string, ask: Ask): string[] {
  const askable = (other: string) => other !== id && canAsk(ask)(ds.byId[other])
  const borders = (ds.neighbors[id] ?? []).filter(askable)
  const twoAway = [...new Set((ds.neighbors[id] ?? []).flatMap((n) => ds.neighbors[n] ?? []))].filter(
    (n) => askable(n) && !borders.includes(n),
  )
  const byDistance = ds.places
    .map((p) => p.id)
    .filter(askable)
    .sort((a, b) => ds.distance(id, a) - ds.distance(id, b))
  const picked: string[] = []
  // The last tier is the rest of the list, nearest first and unshuffled: a final fallback only.
  for (const tier of [shuffle(borders), shuffle(twoAway), shuffle(byDistance.slice(0, 7)), byDistance]) {
    for (const other of tier) {
      if (picked.length < 3 && !picked.includes(other)) picked.push(other)
    }
  }
  return shuffle([id, ...picked])
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
  styleToggle,
}: GameProps & { ask: Ask; style: Exclude<InputStyle, 'map'>; styleToggle: ReactNode }) {
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
    const result = checkTyped(typed, answer, others, ask === 'capital' ? undefined : place.code)
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
