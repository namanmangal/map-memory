import { useEffect, useState } from 'react'
import { DATASETS } from './datasets/registry'
import { DatasetContext, loadDataset, type LoadedDataset } from './datasets/dataset'
import { DailyMode } from './modes/DailyMode'
import { ExploreMode } from './modes/ExploreMode'
import { FindMode } from './modes/FindMode'
import { CapitalMode, NameMode } from './modes/NameMode'
import { DragMode } from './modes/DragMode'
import { HistoryMode } from './modes/HistoryMode'
import {
  dismissResetNotice,
  openProgress,
  progressGeneration,
  progressOutOfDate,
  saving,
  useProgress,
  wasResetElsewhere,
} from './lib/progress'
import { setMuted, useMuted } from './lib/sound'
import { setThemePref, useThemePref, type ThemePref } from './lib/theme'
import { UpdateNotice } from './components/UpdateNotice'

const MODES = [
  { id: 'explore', label: 'Explore', Component: ExploreMode },
  { id: 'daily', label: 'Daily', Component: DailyMode },
  { id: 'find', label: 'Find it', Component: FindMode },
  { id: 'name', label: 'Name it', Component: NameMode },
  { id: 'drag', label: 'Drag & drop', Component: DragMode },
  // Only for maps whose places have capitals
  { id: 'capitals', label: 'Capitals', Component: CapitalMode, available: (ds: LoadedDataset) => ds.hasCapitals },
  { id: 'history', label: 'History', Component: HistoryMode },
] as const

type ModeId = (typeof MODES)[number]['id']

const THEMES: { id: ThemePref; label: string; icon: string }[] = [
  { id: 'light', label: 'Light theme', icon: '☀' },
  { id: 'system', label: 'Auto theme (follows your system)', icon: '◐' },
  { id: 'dark', label: 'Dark theme', icon: '☾' },
]

export default function App() {
  const [datasetId, setDatasetId] = useState(DATASETS[0].id)
  const [mode, setMode] = useState<ModeId>('explore')
  const [loaded, setLoaded] = useState<LoadedDataset | null>(null)
  // Remember which map failed, so switching to one that loads fine shows it instead of an old error.
  const [failure, setFailure] = useState<{ datasetId: string; message: string } | null>(null)
  const error = failure?.datasetId === datasetId ? failure.message : null
  const muted = useMuted()
  const theme = useThemePref()

  // Bumped by "Try again" to reload the current map after a failure.
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let canceled = false
    const config = DATASETS.find((d) => d.id === datasetId)!
    // The map's saved progress loads alongside it, so every tab can read it straight away.
    Promise.all([loadDataset(config), openProgress(config.id)])
      .then(([ds]) => {
        if (canceled) return
        setLoaded(ds)
        setFailure((f) => (f?.datasetId === config.id ? null : f)) // a retry that works clears the old error
      })
      .catch((e: unknown) => !canceled && setFailure({ datasetId, message: String(e) }))
    return () => {
      canceled = true
    }
  }, [datasetId, loadAttempt])

  const ready = loaded?.config.id === datasetId ? loaded : null
  // Changes whenever progress is reset, here or in another browser tab: the quiz tabs then start fresh,
  // rather than carry on with runs whose answers would no longer be saved.
  useProgress()
  const generation = ready ? progressGeneration(ready.config.id) : 0
  const modes = MODES.filter((m) => !('available' in m) || (ready !== null && m.available(ready)))
  // If the chosen tab isn't offered for this map, fall back to Explore.
  const activeMode: ModeId = modes.some((m) => m.id === mode) ? mode : 'explore'

  /** Arrow keys switch tabs (and move focus with them), wrapping at the ends; Home/End jump to the first/last. */
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = modes.findIndex((m) => m.id === activeMode)
    const next =
      e.key === 'ArrowRight' ? (i + 1) % modes.length
      : e.key === 'ArrowLeft' ? (i - 1 + modes.length) % modes.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? modes.length - 1
      : null
    if (next === null) return
    e.preventDefault()
    setMode(modes[next].id)
    document.getElementById(`tab-${modes[next].id}`)?.focus()
  }

  return (
    <div className="app">
      <header>
        <h1>Map Memory</h1>
        {DATASETS.length > 1 && (
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} aria-label="Map">
            {DATASETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        )}
        {/* Tab pattern: only the current tab is in the Tab order; ←/→/Home/End move between tabs. */}
        <nav className="tabs" role="tablist" aria-label="Modes" onKeyDown={onTabKey}>
          {modes.map((m) => (
            <button
              key={m.id}
              id={`tab-${m.id}`}
              role="tab"
              aria-selected={activeMode === m.id}
              aria-controls={`panel-${m.id}`}
              tabIndex={activeMode === m.id ? 0 : -1}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="theme-switch" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              aria-pressed={theme === t.id}
              aria-label={t.label}
              title={t.label}
              onClick={() => setThemePref(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <button
          className="sound-toggle"
          aria-pressed={muted}
          aria-label={muted ? 'Turn sounds on' : 'Mute sounds'}
          title={muted ? 'Sounds off — click to turn on' : 'Sounds on — click to mute'}
          onClick={() => setMuted(!muted)}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      <main>
        <UpdateNotice />
        {error ? (
          <div className="error">
            <p>Couldn't load the map: {error}</p>
            <button onClick={() => setLoadAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : ready ? (
          <DatasetContext.Provider value={ready}>
            {wasResetElsewhere(ready.config.id) && (
              <p className="daily-notice" role="status">
                Progress was reset in another tab, so quizzes here started over.{' '}
                <button className="link" onClick={() => dismissResetNotice(ready.config.id)}>
                  OK
                </button>
              </p>
            )}
            {progressOutOfDate(ready.config.id) && (
              <p className="error" role="status">
                Saved progress may not be showing correctly here. Reload the page to see it.
              </p>
            )}
            {saving() !== 'yes' && (
              <p className="error" role="status">
                {saving() === 'failing'
                  ? "Some progress couldn't be saved just now (the browser's storage may be full). It keeps trying with each new answer."
                  : saving() === 'paused'
                  ? "Progress isn't being saved right now (the browser isn't allowing it). It saves again as soon as the browser allows."
                  : "Progress in this tab isn't being saved (the browser didn't allow it), so it'll be lost when you close or reload the tab."}
              </p>
            )}
            {/* Every tab stays mounted (just hidden) so switching tabs keeps quiz progress.
                Explore keeps its view; every other tab starts fresh after a reset (here or in another browser tab). */}
            {modes.map(({ id, Component }) => (
              <div
                key={id === 'explore' ? `${datasetId}-${id}` : `${datasetId}-${id}-${generation}`}
                hidden={activeMode !== id}
                role="tabpanel"
                id={`panel-${id}`}
                aria-labelledby={`tab-${id}`}
              >
                <Component active={activeMode === id} />
              </div>
            ))}
          </DatasetContext.Provider>
        ) : (
          <p className="muted">Loading map…</p>
        )}
      </main>
    </div>
  )
}
