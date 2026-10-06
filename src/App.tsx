import { useEffect, useState } from 'react'
import { DATASETS } from './datasets/registry'
import { DatasetContext, loadDataset, type LoadedDataset } from './datasets/dataset'
import { ExploreMode } from './modes/ExploreMode'
import { FindMode } from './modes/FindMode'
import { NameMode } from './modes/NameMode'
import { DragMode } from './modes/DragMode'

const MODES = [
  { id: 'explore', label: 'Explore', Component: ExploreMode },
  { id: 'find', label: 'Find it', Component: FindMode },
  { id: 'name', label: 'Name it', Component: NameMode },
  { id: 'drag', label: 'Drag & drop', Component: DragMode },
] as const

type ModeId = (typeof MODES)[number]['id']

export default function App() {
  const [datasetId, setDatasetId] = useState(DATASETS[0].id)
  const [mode, setMode] = useState<ModeId>('explore')
  const [loaded, setLoaded] = useState<LoadedDataset | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const config = DATASETS.find((d) => d.id === datasetId)!
    loadDataset(config)
      .then((ds) => !cancelled && setLoaded(ds))
      .catch((e: unknown) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [datasetId])

  const ready = loaded?.config.id === datasetId ? loaded : null
  const Mode = MODES.find((m) => m.id === mode)!.Component

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
            <Mode key={`${datasetId}-${mode}`} />
          </DatasetContext.Provider>
        ) : (
          <p className="muted">Loading map…</p>
        )}
      </main>
    </div>
  )
}
