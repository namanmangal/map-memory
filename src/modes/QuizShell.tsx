import { useState, type ReactNode } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import { loadBest } from '../lib/progress'
import { formatTime } from '../lib/util'

export type GameProps = {
  ids: string[]
  /** The selected region's places, which the map zooms to */
  focusIds: string[]
  /** Only set for a full run of a group, so practice runs don't count as records */
  bestKey?: string
  onRestart: (ids?: string[]) => void
}

/**
 * Holds the group filter and remounts the game on every restart,
 * so each game component can keep simple local state.
 */
export function QuizShell({ mode, render }: { mode: string; render: (props: GameProps) => ReactNode }) {
  const ds = useDataset()
  const [group, setGroup] = useState(ALL_GROUPS)
  const [practiceIds, setPracticeIds] = useState<string[] | null>(null)
  const [run, setRun] = useState(0)

  const groupIds = ds.idsForGroup(group)
  const ids = practiceIds ?? groupIds
  const bestKey = practiceIds ? undefined : `${mode}:${group}`
  const best = bestKey ? loadBest(ds.config.id, bestKey) : undefined

  const restart = (next?: string[]) => {
    setPracticeIds(next && next.length < groupIds.length ? next : null)
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
        {practiceIds && <span className="pill">Practising {practiceIds.length} missed</span>}
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
        {render({ ids, focusIds: groupIds, bestKey, onRestart: restart })}
      </div>
    </div>
  )
}
