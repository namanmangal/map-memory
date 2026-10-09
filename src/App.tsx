import { useEffect, useState } from 'react'
import { DATASETS } from './datasets/registry'
import { DatasetContext, loadDataset, type LoadedDataset } from './datasets/dataset'
import { ExploreMode } from './modes/ExploreMode'
import { FindMode } from './modes/FindMode'
import { NameMode } from './modes/NameMode'
import { DragMode } from './modes/DragMode'
import { HistoryMode } from './modes/HistoryMode'

const MODES = [
  { id: 'explore', label: 'Explore', Component: ExploreMode },
  { id: 'find', label: 'Find it', Component: FindMode },
  { id: 'name', label: 'Name it', Component: NameMode },
  { id: 'drag', label: 'Drag & drop', Component: DragMode },
  { id: 'history', label: 'History', Component: HistoryMode },
] as const

type ModeId = (typeof MODES)[number]['id']

export default function App() {
  const [datasetId, setDatasetId] = useState(DATASETS[0].id)
  const [mode, setMode] = useState<ModeId>('explore')
  const [loaded, setLoaded] = useState<LoadedDataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped when progress is reset: remounts the other tabs so no in-progress run writes old answers back.
  const [resetCount, setResetCount] = useState(0)

  useEffect(() => {
    let canceled = false
    const config = DATASETS.find((d) => d.id === datasetId)!
    loadDataset(config)
      .then((ds) => !canceled && setLoaded(ds))
      .catch((e: unknown) => !canceled && setError(String(e)))
    return () => {
      canceled = true
    }
  }, [datasetId])

  const ready = loaded?.config.id === datasetId ? loaded : null

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
        <nav className="tabs" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {error ? (
          <p className="error">Couldn't load the map: {error}</p>
        ) : ready ? (
          <DatasetContext.Provider value={ready}>
            {/* Every tab stays mounted (just hidden) so switching tabs keeps quiz progress.
                Explore, where reset happens, keeps its view; every other tab starts fresh after a reset. */}
            {MODES.map(({ id, Component }) => (
              <div
                key={id === 'explore' ? `${datasetId}-${id}` : `${datasetId}-${id}-${resetCount}`}
                hidden={mode !== id}
                role="tabpanel"
              >
                <Component active={mode === id} onProgressReset={() => setResetCount((n) => n + 1)} />
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
