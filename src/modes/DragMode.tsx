import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDataset } from '../datasets/dataset'
import { MapView } from '../map/MapView'
import { QuizShell, type GameProps, type ModeProps } from './QuizShell'
import { QuizPaused, QuizStart } from './QuizStart'
import { QuizTimer } from './QuizTimer'
import { ResultLegend, Summary } from './Summary'
import { MAX_ATTEMPTS, resultFor, useQuizRun } from './useQuizRun'

/** All names in a tray — drag each onto its outline. Tap a name then tap the map also works. */
export function DragMode({ active }: ModeProps) {
  return <QuizShell mode="drag" active={active} render={(props) => <DragGame {...props} />} />
}

type Drag = { id: string; x: number; y: number; startX: number; startY: number; moved: boolean }

/** Finds the place under a screen point; the drag ghost has pointer-events: none so it's skipped. */
function placeAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-place-id]')
  return el?.getAttribute('data-place-id') ?? null
}

function DragGame({ ids, focusIds, bestKey, onRestart, active: tabActive, autoStart, meta }: GameProps) {
  const ds = useDataset()
  const { started, begin, paused, pauseReason, pause, resume, live, running, results, resolve, finish, elapsed } = useQuizRun(
    ids,
    bestKey,
    tabActive,
    autoStart,
    meta,
  )
  const [mistakes, setMistakes] = useState<Record<string, number>>({})
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; ok: boolean } | null>(null)
  const [shake, setShake] = useState<string | null>(null)

  const remaining = [...ids].filter((id) => !results[id]).sort((a, b) => ds.byId[a].name.localeCompare(ds.byId[b].name))

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    if (!shake) return
    const t = setTimeout(() => setShake(null), 450)
    return () => clearTimeout(t)
  }, [shake])

  const place = (nameId: string, targetId: string | null) => {
    // Not before starting or while paused — a paused click mustn't count as a mistake (or unlock the hint).
    if (!live || !targetId || results[targetId]) return
    if (nameId === targetId) {
      resolve(nameId, resultFor(mistakes[nameId] ?? 0))
      setFlash({ id: targetId, ok: true })
      setSelected(null)
    } else {
      setMistakes((m) => ({ ...m, [nameId]: (m[nameId] ?? 0) + 1 }))
      setFlash({ id: targetId, ok: false })
      setShake(nameId)
    }
  }

  // Window listeners read these refs so they always see the latest drag and place() without re-binding.
  const placeRef = useRef(place)
  useEffect(() => {
    placeRef.current = place
  })
  const dragRef = useRef<Drag | null>(null)
  const dragging = drag !== null

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }

  // Pausing (including by leaving the window mid-drag) drops whatever name is being dragged.
  const [wasPaused, setWasPaused] = useState(paused)
  if (paused !== wasPaused) {
    setWasPaused(paused)
    if (paused) {
      // Clearing the drag also removes its window listeners, so the stale ref is never read.
      setDrag(null)
      setOverId(null)
    }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6
      updateDrag({ ...d, x: e.clientX, y: e.clientY, moved })
      setOverId(placeAt(e.clientX, e.clientY))
    }
    const up = (e: PointerEvent) => {
      const d = dragRef.current
      updateDrag(null)
      setOverId(null)
      if (!d) return
      if (d.moved) placeRef.current(d.id, placeAt(e.clientX, e.clientY))
      else setSelected((s) => (s === d.id ? null : d.id))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging])

  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    updateDrag({ id, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false })
  }

  const active = drag?.moved ? drag.id : selected
  const hintId = active && (mistakes[active] ?? 0) >= MAX_ATTEMPTS ? active : null

  const classFor = (id: string) => {
    // While paused, show only placed states — the hint pulse would give the answer away.
    if (paused) return results[id]
    if (flash?.id === id) return flash.ok ? 'just-placed' : 'wrong'
    if (results[id]) return results[id]
    if (id === hintId) return 'pulse'
    if (id === overId) return 'drop-over'
    return active ? 'hoverable' : undefined
  }

  return (
    <div className="game drag-game">
      <div className="prompt">
        {!started && <QuizStart count={ids.length} onStart={begin} />}
        {paused && <QuizPaused elapsed={elapsed()} reason={pauseReason} onResume={resume} />}
        {live && !finish && (
          <>
            <span className="muted">
              {ids.length - remaining.length} of {ids.length} placed
            </span>
            <span className="ask">
              {selected ? (
                <>
                  Now click where <strong>{ds.byId[selected].name}</strong> goes
                </>
              ) : (
                <>Drag each name onto its {ds.config.noun.one}</>
              )}
            </span>
            <span className="feedback">{hintId && 'Stuck? The right spot is flashing.'}</span>
            <QuizTimer elapsed={elapsed} running={running} onPause={pause} />
          </>
        )}
      </div>

      <div className="drag-layout">
        <MapView
          activeIds={new Set(ids)}
          focusIds={focusIds}
          classFor={classFor}
          tooltipFor={(id) => (results[id] ? ds.byId[id].name : undefined)}
          labelFor={(id) => (results[id] ? ds.byId[id].code : undefined)}
          onPick={(id) => selected && place(selected, id)}
        />
        {live && !finish && (
          <ul className="tray" aria-label={`${ds.config.noun.many} to place`}>
            {remaining.map((id) => (
              <li
                key={id}
                className={[
                  'chip',
                  selected === id && 'selected',
                  drag?.moved && drag.id === id && 'lifted',
                  shake === id && 'shake',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onPointerDown={(e) => startDrag(e, id)}
              >
                {ds.byId[id].name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ResultLegend />
      {drag?.moved && (
        <div className="ghost chip" style={{ left: drag.x, top: drag.y }}>
          {ds.byId[drag.id].name}
        </div>
      )}
      {finish && <Summary ids={ids} results={results} finish={finish} onRestart={onRestart} />}
    </div>
  )
}
