import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import { dailyIds, dateKey, resultSquares, streak, timeUntilTomorrow } from '../lib/daily'
import {
  beginAttempt,
  claimDaily,
  loadAttempt,
  loadDaily,
  progressGeneration,
  saveAttempt,
  useProgress,
  type AttemptProgress,
  type DailyRecord,
} from '../lib/progress'
import { formatTime } from '../lib/util'
import { MapView } from '../map/MapView'
import { FindGame } from './FindMode'
import type { ModeProps } from './QuizShell'
import { ResultBreakdown, ResultLegend } from './Summary'
import type { FinishedRun } from './useQuizRun'

/** "2026-10-30" → a local Date (not UTC midnight, which would show the previous day in the Americas). */
const dayToDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
/** One start or continue of the day's attempt in this tab; `generation` is the reset generation it began in. */
type Run = { day: string; n: number; resume: AttemptProgress; generation: number }

/** Identifies this browser tab, so an attempt is only ever played in the tab that last started or continued it. */
const TAB_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

const headerDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const shareDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The same few places for everyone each day, found on the map like Find it. The first finished run
 * of the day is kept, with a shareable result and a streak; replays are practice.
 */
export function DailyMode({ active }: ModeProps) {
  const ds = useDataset()
  // The clock drives the countdown and noticing midnight: re-read when the tab is shown, then every 30 s.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(new Date())
    tick()
    const t = setInterval(tick, 30_000)
    return () => clearInterval(t)
  }, [active])
  const today = dateKey(now)
  // Results saved here or in another tab show as soon as they're saved.
  useProgress()
  const records = loadDaily(ds.config.id)

  // The challenge being shown, and the attempt being played in this tab (each Start or Continue
  // remounts the game with where the attempt had got to).
  const [day, setDay] = useState(today)
  const [playing, setPlaying] = useState<Run | null>(null)
  // The run playing now, kept current immediately (not after the next render), so a request that comes
  // back late can tell whether the run that sent it is still the one playing — after a Continue, it isn't.
  const playingRef = useRef<Run | null>(null)
  const startRun = (run: Run) => {
    playingRef.current = run
    setPlaying(run)
  }
  const endRun = (run: Run) => {
    if (playingRef.current !== run) return false
    playingRef.current = null
    setPlaying(null)
    return true
  }
  const attempt = loadAttempt(ds.config.id, day)
  // Why this tab stopped playing the day's attempt, when a save or the finish was refused: decided by
  // the database itself, so it doesn't depend on hearing from other tabs.
  const [stopped, setStopped] = useState<{ day: string; reason: 'taken-over' | 'reset' } | null>(null)
  /** Stops `run` because a save or its finish was refused — unless a newer run has replaced it since. */
  const stop = (run: Run, reason: 'taken-over' | 'reset') => {
    if (endRun(run)) setStopped({ day: run.day, reason })
  }
  // Playing here: started or continued in this tab, the day isn't finished, and the attempt hasn't
  // since been seen continued in another tab. (If the copy here doesn't have the attempt yet — reading
  // it back failed — the run still plays: starting it returned the attempt. A reset that removed it is
  // caught by the next save, which is refused.)
  const running =
    playing?.day === day && !records[day] && (attempt === undefined || attempt.owner === TAB_ID)
  const takenOver =
    (playing?.day === day && attempt !== undefined && attempt.owner !== TAB_ID) ||
    (stopped?.day === day && stopped.reason === 'taken-over')
  const stoppedByReset = stopped?.day === day && stopped.reason === 'reset'
  // Kept in memory too, in case storage is unavailable and the result couldn't be saved.
  const [unsaved, setUnsaved] = useState<{ day: string; run: DailyRecord } | null>(null)
  const record = records[day] ?? (unsaved?.day === day ? unsaved.run : undefined)
  // Something to explain about the last finished run (it didn't count, or couldn't be saved).
  const [notice, setNotice] = useState<string | null>(null)
  // Practice replays: a count (for remounting each new one) and which places, or null when not practicing.
  const [practice, setPractice] = useState<{ n: number; ids: string[] } | null>(null)

  // At midnight, move on to today's challenge — unless the old day has something to show: a run in
  // progress (counted or practice), or its result (e.g. a run that finished after midnight, so it can
  // still be seen and shared). Those keep their day, and the header offers today's.
  if (day !== today && !running && !practice && !record) {
    setDay(today)
    setNotice(null)
  }

  const pickedIds = useMemo(() => dailyIds(ds.config.id, ds.places.map((p) => p.id), day), [ds, day])
  // An attempt in progress keeps the places it was started with (skipping any the map no longer has).
  const known = (id: string) => Object.hasOwn(ds.byId, id)
  const ids = attempt ? attempt.ids.filter(known) : pickedIds
  // A saved result is shown against the places it was played with, skipping any the map no longer has.
  const playedIds = record ? record.ids.filter((id) => Object.hasOwn(ds.byId, id)) : ids
  const playedDays = new Set([...Object.keys(records), ...(unsaved ? [unsaved.day] : [])])
  const streakDays = streak(playedDays, today)
  const allIds = ds.places.map((p) => p.id)

  /** Decides whether a finished run is the day's result, before it goes into history. */
  const claim = async (finished: FinishedRun) => {
    const run = playingRef.current
    if (!run) return false
    const { status, record: result } = await claimDaily(ds.config.id, run.day, { ids, ...finished }, TAB_ID, run.generation)
    // Taken over by another tab just before finishing (that tab plays on), or progress was reset since
    // starting: this run doesn't count, and the tab says why.
    if (status === 'taken-over' || status === 'stale') {
      stop(run, status === 'stale' ? 'reset' : 'taken-over')
      return false
    }
    // Whether it counts is settled either way; the screen only changes if this is still the run shown.
    if (!endRun(run)) return status !== 'already-played'
    if (status === 'already-played') {
      setNotice('You finished this challenge in another tab first, so that result counts. This run went into History as practice.')
      return false
    }
    if (status === 'failed') {
      // Shown anyway, though it couldn't be stored here.
      setUnsaved({ day: run.day, run: result })
      setNotice("Couldn't save your result in this browser (storage may be full or blocked), so it'll be gone after a reload.")
    }
    return true
  }

  /** Starts the challenge in this tab, or continues it from where it got to. */
  const play = async () => {
    setStopped(null)
    const generation = progressGeneration(ds.config.id)
    const begun = await beginAttempt(ds.config.id, day, ids, TAB_ID, generation)
    // Already finished (the result now shows), or progress was just reset (this tab starts over).
    if (!begun) return
    const results = Object.fromEntries(Object.entries(begun.results).filter(([id]) => known(id)))
    startRun({ day, n: (playingRef.current?.n ?? 0) + 1, resume: { results, mistakes: begun.mistakes, ms: begun.ms }, generation })
  }

  return (
    <div className="quiz daily">
      <div className="toolbar">
        <strong>{headerDate.format(dayToDate(day))}</strong>
        {streakDays > 0 && <span className="pill">🔥 {streakDays}-day streak</span>}
        {day !== today && (
          <span className="muted">
            A new challenge is ready.{' '}
            <button
              className="link"
              onClick={() => {
                setDay(today)
                playingRef.current = null
                setPlaying(null)
                setPractice(null)
                setNotice(null)
              }}
            >
              Go to today's
            </button>
          </span>
        )}
      </div>

      {practice ? (
        <>
          <p className="muted daily-note">
            Practice run — your result for the day stays as it was.{' '}
            <button className="link" onClick={() => setPractice(null)}>
              Back to the result
            </button>
          </p>
          <div key={practice.n} className="quiz-body">
            <FindGame
              ids={practice.ids}
              focusIds={allIds}
              onRestart={(next) => setPractice({ n: practice.n + 1, ids: next ?? playedIds })}
              active={active}
              autoStart
              pickFrom={allIds}
              meta={{ mode: 'daily', group: ALL_GROUPS, practice: true }}
              onFinish={() => {}}
            />
          </div>
        </>
      ) : record && !running ? (
        <>
          {notice && (
            <p className="daily-notice" role="status">
              {notice}
            </p>
          )}
          <DailyResult
            day={day}
            record={record}
            streakDays={streakDays}
            now={now}
            onPractice={() => setPractice({ n: 0, ids: playedIds })}
          />
        </>
      ) : running && playing ? (
        <div key={`${day}-${playing.n}`} className="quiz-body">
          <FindGame
            ids={ids}
            focusIds={allIds}
            onRestart={() => {}}
            active={active}
            autoStart
            inOrder
            // Every place is clickable, so finding one means knowing where it is, not picking among a few
            pickFrom={allIds}
            meta={{ mode: 'daily', group: ALL_GROUPS, practice: false }}
            onFinish={() => {}}
            hooks={{
              claim,
              resume: playing.resume,
              // Saved after every answer, so reloading continues the attempt instead of starting over.
              // If another tab has taken it over, or progress was reset, the save is refused and this tab
              // stops playing it and says why.
              // `playing` here is this run: a refusal that comes back after a newer run started is ignored.
              onProgress: (progress) =>
                void saveAttempt(ds.config.id, day, TAB_ID, progress, playing.generation).then((status) => {
                  if (status === 'taken-over') stop(playing, 'taken-over')
                  else if (status === 'stale') stop(playing, 'reset')
                }),
            }}
          />
        </div>
      ) : (
        <>
          <p className="muted daily-note">
            The same {ids.length} {ds.config.noun.many} for everyone today, in the same order. Your first finished run counts,
            and each answer is saved as you go, so reloading picks up where you left off.
          </p>
          {takenOver && (
            <p className="daily-notice" role="status">
              You continued this challenge in another tab. Continue here to play it in this tab instead.
            </p>
          )}
          {stoppedByReset && (
            <p className="daily-notice" role="status">
              Progress was reset, so the run you were playing here stopped and didn't count.
            </p>
          )}
          <div className="prompt">
            <span className="ask">
              {attempt
                ? `In progress: ${Object.keys(attempt.results).length} of ${ids.length} done`
                : `${ids.length} ${ds.config.noun.many} — ready?`}
            </span>
            <button className="start" onClick={play}>
              {attempt ? 'Continue' : "Start today's challenge"}
            </button>
            <span className="timer">⏱ {formatTime(attempt?.ms ?? 0)}</span>
          </div>
          <MapView
            activeIds={new Set(allIds)}
            classFor={(id) => attempt?.results[id]}
            labelFor={(id) => (attempt?.results[id] ? ds.byId[id].code : undefined)}
            tooltipFor={(id) => (attempt?.results[id] ? ds.byId[id].name : undefined)}
          />
          <ResultLegend />
        </>
      )}
    </div>
  )
}

/** The day's result: squares, score, a copyable summary for sharing, and the map of how it went. */
function DailyResult({
  day,
  record,
  streakDays,
  now,
  onPractice,
}: {
  day: string
  record: DailyRecord
  streakDays: number
  now: Date
  onPractice: () => void
}) {
  const ds = useDataset()
  const [copied, setCopied] = useState(false)
  // Shown when the clipboard can't be written (e.g. not allowed), so the text can be copied by hand.
  const [showText, setShowText] = useState(false)
  // Scored exactly as played, from the stored places and outcomes; places the map no longer has are
  // only left out of the name lists and the map, which can't show them.
  const ids = record.ids
  const shownIds = ids.filter((id) => Object.hasOwn(ds.byId, id))
  const first = ids.filter((id) => record.results[id] === 'first').length
  const squares = resultSquares(ids, record.results)

  const shareText = [
    `Map Memory · ${ds.config.title} · ${shareDate.format(dayToDate(day))}`,
    squares,
    `${first}/${ids.length} first try · ${formatTime(record.ms)}${streakDays > 1 ? ` · 🔥 ${streakDays}` : ''}`,
    `${location.origin}${location.pathname}`,
  ].join('\n')

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
    } catch {
      setShowText(true)
    }
  }

  return (
    <>
      <div className="summary daily-result">
        <h2>{first === ids.length ? 'Perfect!' : day === dateKey(now) ? "Today's challenge: done" : 'Challenge done'}</h2>
        {/* The squares repeat the score below, so screen readers get the score instead. */}
        <p className="daily-squares" aria-hidden>
          {squares}
        </p>
        <p className="score">
          <strong>
            {first}/{ids.length}
          </strong>{' '}
          on the first try · {formatTime(record.ms)}
        </p>
        <div className="actions">
          <button onClick={copy}>{copied ? 'Copied!' : 'Copy result to share'}</button>
          {shownIds.length > 0 && (
            <button className="ghost" onClick={onPractice}>
              Practice these {shownIds.length} again
            </button>
          )}
        </div>
        {/* Announced to screen readers when the copy succeeds */}
        <span className="sr-only" role="status">
          {copied ? 'Result copied to the clipboard' : ''}
        </span>
        {showText && (
          <label className="share-text">
            Couldn't copy automatically — select and copy this:
            <textarea readOnly value={shareText} rows={4} onFocus={(e) => e.target.select()} />
          </label>
        )}
        <p className="muted">
          {day === dateKey(now) ? `Next challenge in ${timeUntilTomorrow(now)}.` : 'A new challenge is ready.'}
        </p>
        {shownIds.length < ids.length && (
          <p className="muted">
            {ids.length - shownIds.length} of this challenge's {ds.config.noun.many} {ids.length - shownIds.length === 1 ? "isn't" : "aren't"}{' '}
            on the map any more, so {ids.length - shownIds.length === 1 ? "it's" : "they're"} left out below; the score above still counts{' '}
            {ids.length - shownIds.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        {shownIds.length > 0 && <ResultBreakdown ids={shownIds} results={record.results} />}
      </div>
      <MapView
        activeIds={new Set(shownIds)}
        classFor={(id) => record.results[id]}
        labelFor={(id) => (record.results[id] ? ds.byId[id].code : undefined)}
        tooltipFor={(id) => (record.results[id] ? ds.byId[id].name : undefined)}
      />
      <ResultLegend />
    </>
  )
}
