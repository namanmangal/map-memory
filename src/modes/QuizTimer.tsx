import { useEffect, useState } from 'react'
import { formatTime } from '../lib/util'

/** Live elapsed time for a quiz run; ticks only while the run's tab is showing. */
export function QuizTimer({
  elapsed,
  running,
  onPause,
}: {
  elapsed: () => number
  running: boolean
  onPause?: () => void
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  return (
    <span className="timer">
      {/* aria-live off so screen readers inside the prompt's live region aren't told every second */}
      <span role="timer" aria-live="off" aria-label="Time">
        ⏱ {formatTime(elapsed())}
      </span>
      {onPause && (
        <button className="ghost pause" onClick={onPause}>
          ⏸ Pause
        </button>
      )}
    </span>
  )
}
