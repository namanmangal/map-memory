import { Fragment, useState } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import { loadRuns, type RunRecord } from '../lib/progress'
import { formatTime } from '../lib/util'
import type { ModeProps } from './QuizShell'
import { ResultBreakdown } from './Summary'
import { MAX_ATTEMPTS, scoreOf } from './useQuizRun'

/** Display names for the quiz `mode` strings stored with each run */
const QUIZ_LABELS: Record<string, string> = {
  find: 'Find it',
  'name-type': 'Name it · Type',
  'name-choose': 'Name it · Choose',
  drag: 'Drag & drop',
}

const ALL = 'all'

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** Every finished quiz run, newest first, with the full breakdown on demand. */
export function HistoryMode({ active }: ModeProps) {
  const ds = useDataset()
  const [runs, setRuns] = useState(() => loadRuns(ds.config.id))
  const [quiz, setQuiz] = useState(ALL)
  const [group, setGroup] = useState(ALL)
  const [openId, setOpenId] = useState<string | null>(null)

  // Quizzes on other tabs add runs, so re-read history whenever this tab is shown again.
  const [wasActive, setWasActive] = useState(active)
  if (active !== wasActive) {
    setWasActive(active)
    if (active) setRuns(loadRuns(ds.config.id))
  }

  const shown = runs.filter((r) => (quiz === ALL || r.mode === quiz) && (group === ALL || r.group === group)).reverse()
  const totalMs = shown.reduce((sum, r) => sum + r.ms, 0)
  const groupLabel = (g: string) => (g === ALL_GROUPS ? `All ${ds.places.length}` : g)

  if (runs.length === 0) {
    return (
      <div className="history empty">
        <h2>No quizzes yet</h2>
        <p className="muted">
          Finish a quiz in Find it, Name it or Drag & drop and it'll show up here, with your score, time and every{' '}
          {ds.config.noun.one} you got right or missed.
        </p>
      </div>
    )
  }

  return (
    <div className="history">
      <div className="toolbar">
        <label>
          Quiz{' '}
          <select value={quiz} onChange={(e) => setQuiz(e.target.value)}>
            <option value={ALL}>All quizzes</option>
            {Object.entries(QUIZ_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {ds.config.groupLabel}{' '}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value={ALL}>Any</option>
            <option value={ALL_GROUPS}>{groupLabel(ALL_GROUPS)}</option>
            {ds.config.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <span className="muted totals">
          {shown.length} {shown.length === 1 ? 'run' : 'runs'} · {formatTime(totalMs)} total
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted">No runs match these filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="runs">
            <thead>
              <tr>
                <th>Date</th>
                <th>Quiz</th>
                <th>{ds.config.groupLabel}</th>
                <th className="num">First try</th>
                <th className="num">Time</th>
                <th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {shown.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  open={openId === run.id}
                  onToggle={() => setOpenId((o) => (o === run.id ? null : run.id))}
                  groupLabel={groupLabel(run.group)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RunRow({
  run,
  open,
  onToggle,
  groupLabel,
}: {
  run: RunRecord
  open: boolean
  onToggle: () => void
  groupLabel: string
}) {
  const ids = Object.keys(run.results)
  const { first, total, firstPct, gotPct } = scoreOf(ids, run.results)

  return (
    <Fragment>
      <tr className={`run ${open ? 'open' : ''}`} onClick={onToggle}>
        <td>{dateFormat.format(new Date(run.date))}</td>
        <td>{QUIZ_LABELS[run.mode] ?? run.mode}</td>
        <td>
          {groupLabel}
          {run.practice && <span className="pill">Practice</span>}
        </td>
        <td className="num">
          {first}/{total} <span className="muted">· {firstPct}%</span>
        </td>
        <td className="num">{formatTime(run.ms)}</td>
        <td className="num">
          <button
            className="link"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="run-details">
          <td colSpan={6}>
            <p className="muted">
              {gotPct}% within {MAX_ATTEMPTS} tries
            </p>
            <ResultBreakdown ids={ids} results={run.results} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
