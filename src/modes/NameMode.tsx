import { useMemo, useState, type FormEvent } from 'react'
import { useDataset, type LoadedDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { levenshtein, normalize, shuffle } from '../lib/util'
import { QuizShell, type GameProps } from './QuizShell'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

type InputStyle = 'type' | 'choose'

/** A place is highlighted — type or pick its name. */
export function NameMode() {
  const [style, setStyle] = useState<InputStyle>('type')
  return (
    <QuizShell
      mode={`name-${style}`}
      render={(props) => <NameGame {...props} style={style} onStyle={setStyle} />}
    />
  )
}

/** Three wrong options drawn from the nearest neighbours, so the choice isn't trivial. */
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
  onRestart,
  style,
  onStyle,
}: GameProps & { style: InputStyle; onStyle: (s: InputStyle) => void }) {
  const ds = useDataset()
  const [queue] = useState(() => shuffle(ids))
  const { results, resolve, finish, done } = useQuizRun(ids, bestKey)
  const [mistakes, setMistakes] = useState(0)
  const [wrongChoices, setWrongChoices] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')

  const current = queue.find((id) => !results[id])
  const revealed = mistakes >= MAX_ATTEMPTS
  const choices = useMemo(() => (current ? choicesFor(ds, current) : []), [ds, current])

  const advance = () => {
    if (!current) return
    resolve(current, resultFor(mistakes))
    setMistakes(0)
    setWrongChoices([])
    setTyped('')
  }

  const miss = () => setMistakes((m) => m + 1)

  const choose = (id: string) => {
    if (!current || revealed) return
    if (id === current) {
      setNote(`✓ ${ds.byId[current].name}`)
      advance()
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
      setNote(result === 'typo' ? `✓ Close enough — it's spelled ${place.name}` : `✓ ${place.name}`)
      advance()
    }
  }

  const classFor = (id: string) => (id === current ? 'target' : results[id])

  return (
    <div className="game">
      <div className="prompt" aria-live="polite">
        {!finish && current && (
          <>
            <span className="muted">
              {done + 1} of {ids.length}
            </span>
            <span className="ask">
              Which {ds.config.noun.one} is highlighted?
            </span>
            <span className="segmented">
              <button className={style === 'type' ? 'on' : ''} onClick={() => onStyle('type')}>
                Type
              </button>
              <button className={style === 'choose' ? 'on' : ''} onClick={() => onStyle('choose')}>
                Choose
              </button>
            </span>
          </>
        )}
      </div>

      {!finish && current && (
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
                {style === 'choose' && <button onClick={advance}>Next</button>}
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
