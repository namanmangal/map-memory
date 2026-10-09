import { useMemo, useState, type FormEvent } from 'react'
import { useDataset, type LoadedDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { levenshtein, normalize, shuffle } from '../lib/util'
import { QuizShell, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

type InputStyle = 'type' | 'choose'

const STYLES: InputStyle[] = ['type', 'choose']

/**
 * A place is highlighted — type or pick its name. Type and Choose are separate quizzes,
 * each with its own region, progress, timer and best score; both stay mounted so
 * switching between them doesn't lose either run.
 */
export function NameMode({ active }: ModeProps) {
  const [style, setStyle] = useState<InputStyle>('type')
  return (
    <>
      {STYLES.map((s) => (
        <div key={s} hidden={style !== s}>
          <QuizShell
            mode={`name-${s}`}
            active={active && style === s}
            render={(props) => <NameGame {...props} style={s} onStyle={setStyle} />}
          />
        </div>
      ))}
    </>
  )
}

/** Three wrong options drawn from the nearest neighbors, so the choice isn't trivial. */
function choicesFor(ds: LoadedDataset, id: string): string[] {
  const nearby = ds.places
    .map((p) => p.id)
    .filter((other) => other !== id)
    .sort((a, b) => ds.distance(id, a) - ds.distance(id, b))
    .slice(0, 7)
  return shuffle([id, ...shuffle(nearby).slice(0, 3)])
}

type Check = 'right' | 'typo' | 'wrong'

function checkTyped(answer: string, name: string, code: string): Check {
  const a = normalize(answer)
  const n = normalize(name)
  if (a === n || a === code.toLowerCase()) return 'right'
  if (n.length > 5 && levenshtein(a, n) === 1) return 'typo'
  return 'wrong'
}

function NameGame({
  ids,
  focusIds,
  bestKey,
  active,
  autoStart,
  meta,
  onRestart,
  style,
  onStyle,
}: GameProps & { style: InputStyle; onStyle: (s: InputStyle) => void }) {
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
  const [wrongChoices, setWrongChoices] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')

  const current = queue.find((id) => !results[id])
  const revealed = mistakes >= MAX_ATTEMPTS
  const choices = useMemo(() => (current ? choicesFor(ds, current) : []), [ds, current])

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
      advance(`✓ ${ds.byId[current].name}`)
    } else {
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
    const result = checkTyped(typed, place.name, place.code)
    if (result === 'wrong') {
      setNote(`Not ${typed.trim()}`)
      setTyped('')
      miss()
    } else {
      advance(result === 'typo' ? `✓ Close enough — it's spelled ${place.name}` : `✓ ${place.name}`)
    }
  }

  // Before starting, and while paused, don't highlight the current question.
  const classFor = (id: string) => (!started ? undefined : id === current && live ? 'target' : results[id])

  // Available before starting too, so you can pick how to answer first.
  const styleToggle = (
    <span className="segmented">
      <button className={style === 'type' ? 'on' : ''} onClick={() => onStyle('type')}>
        Type
      </button>
      <button className={style === 'choose' ? 'on' : ''} onClick={() => onStyle('choose')}>
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
        {live && !finish && current && (
          <>
            <span className="muted">
              {done + 1} of {ids.length}
            </span>
            <span className="ask">
              Which {ds.config.noun.one} is highlighted?
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
                  {ds.byId[id].name}
                </button>
              ))}
            </div>
          ) : (
            <form className="type-form" onSubmit={submit}>
              <input
                autoFocus
                value={revealed ? ds.byId[current].name : typed}
                readOnly={revealed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={`${ds.config.noun.one[0].toUpperCase()}${ds.config.noun.one.slice(1)} name`}
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
                It's <strong>{ds.byId[current].name}</strong>.{' '}
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
        tooltipFor={(id) => (results[id] ? ds.byId[id].name : undefined)}
      />
      <ResultLegend />
      {finish && <Summary ids={ids} results={results} finish={finish} onRestart={onRestart} />}
    </div>
  )
}
