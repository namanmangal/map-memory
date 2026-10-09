import { useDataset } from '../datasets/dataset'
import { formatTime } from '../lib/util'
import type { PauseReason } from './useQuizRun'

/** Prompt-row contents before a run starts: what's coming, a Start button, and the clock at zero. */
export function QuizStart({ count, onStart, children }: { count: number; onStart: () => void; children?: React.ReactNode }) {
  const ds = useDataset()
  return (
    <>
      <span className="ask">
        {count} {count === 1 ? ds.config.noun.one : ds.config.noun.many} — ready?
      </span>
      <button className="start" onClick={onStart}>
        Start quiz
      </button>
      {children}
      <span className="timer">⏱ {formatTime(0)}</span>
    </>
  )
}

/** Prompt-row contents while a run is paused. */
export function QuizPaused({
  elapsed,
  reason,
  onResume,
  children,
}: {
  elapsed: number
  reason: PauseReason | null
  onResume: () => void
  children?: React.ReactNode
}) {
  return (
    <>
      <span className="ask">{reason === 'left' ? 'Paused — you left the window' : 'Quiz paused'}</span>
      <button className="start" onClick={onResume}>
        Resume quiz
      </button>
      {children}
      <span className="timer">⏱ {formatTime(elapsed)}</span>
    </>
  )
}
