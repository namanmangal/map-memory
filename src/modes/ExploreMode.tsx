import { useState } from 'react'
import { ALL_GROUPS, useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import type { ModeProps } from './QuizShell'
import { hasProgress, loadStats, mastery, resetProgress } from '../lib/progress'

function masteryClass(m: number | null): string {
  if (m === null) return 'm-unseen'
  if (m >= 0.8) return 'm-high'
  if (m >= 0.5) return 'm-mid'
  return 'm-low'
}

/** Browse the map: hover for names, click for details, optionally color by how well you know each place. */
export function ExploreMode({ active, onProgressReset }: ModeProps) {
  const ds = useDataset()
  const [selected, setSelected] = useState<string | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [byMastery, setByMastery] = useState(false)
  const [listOrder, setListOrder] = useState<'group' | 'alpha'>('alpha')
  const [stats, setStats] = useState(() => loadStats(ds.config.id))
  // Quizzes on other tabs record new stats, so re-read them whenever this tab is shown again.
  const [wasActive, setWasActive] = useState(active)
  if (active !== wasActive) {
    setWasActive(active)
    if (active) setStats(loadStats(ds.config.id))
  }
  const [group, setGroup] = useState(ALL_GROUPS)
  const [zoomTarget, setZoomTarget] = useState<{ id?: string; nonce: number; levelOf?: string[] } | null>(null)
  const changeGroup = (next: string) => {
    setGroup(next)
    // Drop a selection that's now outside the region, since it can't be clicked any more.
    if (selected && next !== ALL_GROUPS && ds.byId[selected].group !== next) setSelected(null)
  }
  // Center on the state at its region's zoom level, so neighbors stay in view.
  const zoomTo = (id: string) =>
    setZoomTarget((z) => ({ id, nonce: (z?.nonce ?? 0) + 1, levelOf: ds.idsForGroup(ds.byId[id].group) }))
  const zoomOut = () => setZoomTarget((z) => ({ nonce: (z?.nonce ?? 0) + 1 }))
  const [mapAtStart, setMapAtStart] = useState(true)

  const groupIds = ds.idsForGroup(group)
  const inGroup = new Set(groupIds)
  const allGroups = group === ALL_GROUPS

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
          {ds.config.groupLabel}{' '}
          <select
            value={group}
            onChange={(e) => changeGroup(e.target.value)}
          >
            <option value={ALL_GROUPS}>All {ds.places.length}</option>
            {ds.config.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
        </label>
        <label>
          <input type="checkbox" checked={byMastery} onChange={(e) => setByMastery(e.target.checked)} /> Color by
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
          activeIds={allGroups ? undefined : inGroup}
          focusIds={groupIds}
          zoomable
          classFor={classFor}
          labelFor={showLabels ? (id) => ds.byId[id].code : undefined}
          tooltipFor={(id) => ds.byId[id].name}
          onPick={(id) => {
            // Clicking the selected state again deselects it and zooms back out.
            if (id === selected) {
              setSelected(null)
              zoomOut()
              return
            }
            setSelected(id)
            zoomTo(id)
          }}
          zoomTarget={zoomTarget}
          onViewChange={setMapAtStart}
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
              {/* Zoomed in (by this button, clicking the state, or by hand)? Offer the way back out. */}
              {mapAtStart ? (
                <button className="ghost" onClick={() => zoomTo(place.id)}>
                  Zoom to {place.name}
                </button>
              ) : (
                <button className="ghost" onClick={zoomOut}>
                  Zoom out
                </button>
              )}
            </>
          ) : (
            <p className="muted">Click a {ds.config.noun.one} to see its details.</p>
          )}

          {!allGroups && (
            <button className="link back-to-all" onClick={() => changeGroup(ALL_GROUPS)}>
              ← Back to all {ds.places.length} {ds.config.noun.many}
            </button>
          )}

          <details className="list">
            <summary>
              {allGroups ? `All ${groupIds.length}` : `${groupIds.length} ${group}`} {ds.config.noun.many}
            </summary>
            <span className="segmented small">
              <button className={listOrder === 'alpha' ? 'on' : ''} onClick={() => setListOrder('alpha')}>
                A–Z
              </button>
              <button className={listOrder === 'group' ? 'on' : ''} onClick={() => setListOrder('group')}>
                By {ds.config.groupLabel.toLowerCase()}
              </button>
            </span>
            {(listOrder === 'group' ? ds.config.groups.filter((g) => allGroups || g === group) : [null]).map((g) => (
              <div key={g ?? 'all'}>
                {g && (
                  <h3>
                    {/* Same as picking the region in the dropdown; clicking the current region goes back to all. */}
                    <button
                      className="region-link"
                      aria-pressed={group === g}
                      title={group === g ? `Show all ${ds.config.noun.many}` : `Zoom to ${g}`}
                      onClick={() => changeGroup(group === g ? ALL_GROUPS : g)}
                    >
                      {g}
                      {group === g && <span aria-hidden> ×</span>}
                    </button>
                  </h3>
                )}
                <ul>
                  {ds.places
                    .filter((p) => inGroup.has(p.id) && (g === null || p.group === g))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          className={`link ${p.id === selected ? 'on' : ''}`}
                          onClick={() => {
                            setSelected(p.id)
                            zoomTo(p.id)
                          }}
                        >
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
            disabled={!hasProgress(ds.config.id)}
            title={hasProgress(ds.config.id) ? undefined : 'Nothing to reset yet'}
            onClick={() => {
              if (confirm(`Reset all progress and quiz history for ${ds.config.title}?`)) {
                resetProgress(ds.config.id)
                setStats({})
                onProgressReset()
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
