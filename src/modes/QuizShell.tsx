import { useState, type ReactNode } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import { loadBest, type RunMeta } from '../lib/progress'
import { formatTime } from '../lib/util'

export type GameProps = {
  ids: string[]
  /** The selected region's places, which the map zooms to */
  focusIds: string[]
  /** Only set for a full run of a group, so practice runs don't count as records */
  bestKey?: string
  onRestart: (ids?: string[]) => void
  /** False while another tab is showing; the game stays mounted (keeping its progress) but its timer pauses */
  active: boolean
  /** Start straight away (the user restarted) instead of waiting for the Start button */
  autoStart: boolean
  /** Recorded with the run in the quiz history */
  meta: RunMeta
}

/** Props every tab gets; tabs stay mounted when hidden so switching doesn't lose progress */
export type ModeProps = {
  active: boolean
  /** Called after progress is reset, so the app can discard in-progress runs on other tabs */
  onProgressReset: () => void
}

/**
 * Holds the group filter and remounts the game on every restart,
 * so each game component can keep simple local state.
 */
export function QuizShell({
  mode,
  active,
  render,
}: {
  mode: string
  active: boolean
  render: (props: GameProps) => ReactNode
}) {
  const ds = useDataset()
  const [group, setGroup] = useState(ALL_GROUPS)
  const [practiceIds, setPracticeIds] = useState<string[] | null>(null)
  const [run, setRun] = useState(0)
  const [autoStart, setAutoStart] = useState(false)

  const groupIds = ds.idsForGroup(group)
  const ids = practiceIds ?? groupIds
  const bestKey = practiceIds ? undefined : `${mode}:${group}`
  const best = bestKey ? loadBest(ds.config.id, bestKey) : undefined

  const restart = (next?: string[]) => {
    setPracticeIds(next && next.length < groupIds.length ? next : null)
    setAutoStart(true)
    setRun((r) => r + 1)
  }

  return (
    <div className="quiz">
      <div className="toolbar">
        <label>
          {ds.config.groupLabel}{' '}
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value)
              setPracticeIds(null)
              setAutoStart(false)
              setRun((r) => r + 1)
            }}
          >
            <option value={ALL_GROUPS}>All {ds.places.length}</option>
            {ds.config.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        {practiceIds && <span className="pill">
            Practicing {practiceIds.length} {practiceIds.length === 1 ? ds.config.noun.one : ds.config.noun.many}
          </span>}
        {best && (
          <span className="muted">
            Best: {best.correct}/{best.total} in {formatTime(best.ms)}
          </span>
        )}
        <button className="ghost" onClick={() => restart(practiceIds ?? undefined)}>
          Restart
        </button>
      </div>
      <div key={`${group}-${run}`} className="quiz-body">
        {render({
          ids,
          focusIds: groupIds,
          bestKey,
          onRestart: restart,
          active,
          autoStart,
          meta: { mode, group, practice: practiceIds !== null },
        })}
      </div>
    </div>
  )
}
