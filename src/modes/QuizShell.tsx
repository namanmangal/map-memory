import { useState, type ReactNode } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import type { Place } from '../datasets/types'
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
  /** Tells the shell a run finished, so the toolbar's best score refreshes */
  onFinish: () => void
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
  eligible,
  render,
}: {
  mode: string
  active: boolean
  /** Only quiz places this accepts (e.g. ones that have a capital); default all */
  eligible?: (place: Place) => boolean
  render: (props: GameProps) => ReactNode
}) {
  const ds = useDataset()
  const [group, setGroup] = useState(ALL_GROUPS)
  const [practiceIds, setPracticeIds] = useState<string[] | null>(null)
  const [run, setRun] = useState(0)
  const [autoStart, setAutoStart] = useState(false)
  // Bumped when a run finishes so the "Best" score below is re-read from storage.
  const [, setFinishedRuns] = useState(0)

  const canAsk = (id: string) => !eligible || eligible(ds.byId[id])
  const groupIds = ds.idsForGroup(group).filter(canAsk)
  const totalCount = ds.places.filter((p) => canAsk(p.id)).length
  const ids = practiceIds ?? groupIds
  const bestKey = practiceIds ? undefined : `${mode}:${group}`
  const best = bestKey ? loadBest(ds.config.id, bestKey) : undefined

  const restart = (next?: string[]) => {
    // Started from a practice list (even one covering every state) → practice: labeled, never a best score.
    setPracticeIds(next ?? null)
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
            <option value={ALL_GROUPS}>All {totalCount}</option>
            {ds.config.groups.map((g) => {
              // A region with nothing this quiz can ask (e.g. no capitals) can't be chosen.
              const count = ds.idsForGroup(g).filter(canAsk).length
              return (
                <option key={g} value={g} disabled={count === 0}>
                  {count === 0 ? `${g} (none)` : g}
                </option>
              )
            })}
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
          onFinish: () => setFinishedRuns((n) => n + 1),
        })}
      </div>
    </div>
  )
}
