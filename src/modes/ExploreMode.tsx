import { useState } from 'react'
import { useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { loadStats, mastery, resetProgress } from '../lib/progress'

function masteryClass(m: number | null): string {
  if (m === null) return 'm-unseen'
  if (m >= 0.8) return 'm-high'
  if (m >= 0.5) return 'm-mid'
  return 'm-low'
}

/** Browse the map: hover for names, click for details, optionally colour by how well you know each place. */
export function ExploreMode() {
  const ds = useDataset()
  const [selected, setSelected] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [byMastery, setByMastery] = useState(false)
  const [listOrder, setListOrder] = useState<'group' | 'alpha'>('group')
  const [stats, setStats] = useState(() => loadStats(ds.config.id))

  const place = selected ? ds.byId[selected] : null
  const stat = selected ? stats[selected] : undefined

  const classFor = (id: string) =>
    [id === selected && 'selected', byMastery ? masteryClass(mastery(stats[id])) : 'hoverable']
      .filter(Boolean)
      .join(' ')

  return (
    <div className="explore">
      <div className="toolbar">
        <label>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
        </label>
        <label>
          <input type="checkbox" checked={byMastery} onChange={(e) => setByMastery(e.target.checked)} /> Colour by
          how well I know them
        </label>
        {byMastery && (
          <span className="legend">
            <i className="m-high" /> Know it <i className="m-mid" /> Getting there <i className="m-low" /> Needs work{' '}
            <i className="m-unseen" /> Not quizzed
          </span>
        )}
      </div>

      <div className="explore-layout">
        <MapView
          zoomable
          classFor={classFor}
          labelFor={showLabels ? (id) => ds.byId[id].code : undefined}
          tooltipFor={(id) => ds.byId[id].name}
          onPick={(id) => setSelected((s) => (s === id ? null : id))}
        />

        <aside className="info">
          {place ? (
            <>
              <h2>
                {place.name} <span className="code">{place.code}</span>
              </h2>
              <dl>
                {[
                  ...(place.capital ? [['Capital', place.capital]] : []),
                  [ds.config.groupLabel, place.group],
                  ...Object.entries(place.facts ?? {}),
                  ['Your record', stat ? `${stat.firstTry} of ${stat.seen} first try` : 'Not quizzed yet'],
                ].map(([k, v]) => (
                  <div key={k} className="row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="muted">Click a {ds.config.noun.one} to see its details.</p>
          )}

          <details className="list">
            <summary>
              All {ds.places.length} {ds.config.noun.many}
            </summary>
            <span className="segmented small">
              <button className={listOrder === 'group' ? 'on' : ''} onClick={() => setListOrder('group')}>
                By {ds.config.groupLabel.toLowerCase()}
              </button>
              <button className={listOrder === 'alpha' ? 'on' : ''} onClick={() => setListOrder('alpha')}>
                A–Z
              </button>
            </span>
            {(listOrder === 'group' ? ds.config.groups : [null]).map((g) => (
              <div key={g ?? 'all'}>
                {g && <h3>{g}</h3>}
                <ul>
                  {ds.places
                    .filter((p) => g === null || p.group === g)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <li key={p.id}>
                        <button className={`link ${p.id === selected ? 'on' : ''}`} onClick={() => setSelected(p.id)}>
                          {p.name}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </details>

          <button
            className="link danger"
            onClick={() => {
              if (confirm(`Reset all progress for ${ds.config.title}?`)) {
                resetProgress(ds.config.id)
                setStats({})
              }
            }}
          >
            Reset progress
          </button>
        </aside>
      </div>
    </div>
  )
}
