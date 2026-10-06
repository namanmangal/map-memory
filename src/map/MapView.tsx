import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDataset } from '../datasets/dataset'
import { boundsOf, type Bounds } from './geo'

type Props = {
  /** Places that can be interacted with; everything else is dimmed. Omit for all. */
  activeIds?: Set<string>
  /** The map fits to these places (e.g. the selected region). Omit for the whole map. */
  focusIds?: string[]
  /** Enables scroll/pinch zoom, drag-to-pan and the zoom buttons */
  zoomable?: boolean
  classFor?: (id: string) => string | undefined
  labelFor?: (id: string) => string | undefined
  /** Text for the hover tooltip; return undefined for no tooltip */
  tooltipFor?: (id: string) => string | undefined
  onPick?: (id: string) => void
  onHover?: (id: string | null) => void
}

type Box = { x: number; y: number; w: number; h: number }

const MAX_ZOOM = 8
const BUTTON_STEP = 1.6

function parseBox(viewBox: string): Box {
  const [x, y, w, h] = viewBox.trim().split(/\s+/).map(Number)
  return { x, y, w, h }
}

/** Keeps the view inside the full map and within the zoom limits, at the map's aspect ratio. */
function clampBox(b: Box, base: Box): Box {
  const w = Math.min(Math.max(b.w, base.w / MAX_ZOOM), base.w)
  const h = (w * base.h) / base.w
  return {
    x: Math.min(Math.max(b.x, base.x), base.x + base.w - w),
    y: Math.min(Math.max(b.y, base.y), base.y + base.h - h),
    w,
    h,
  }
}

/** A padded box around the bounds, widened to the map's aspect ratio. */
function fitBox([x0, y0, x1, y1]: Bounds, base: Box): Box {
  const pad = Math.max(x1 - x0, y1 - y0) * 0.08
  let x = x0 - pad
  let y = y0 - pad
  let w = x1 - x0 + pad * 2
  let h = y1 - y0 + pad * 2
  const aspect = base.w / base.h
  if (w / h > aspect) {
    const nh = w / aspect
    y -= (nh - h) / 2
    h = nh
  } else {
    const nw = h * aspect
    x -= (nw - w) / 2
    w = nw
  }
  return clampBox({ x, y, w, h }, base)
}

/** Zooms by `factor` (>1 = in) keeping the map point (px, py) fixed on screen. */
function zoomAt(b: Box, px: number, py: number, factor: number, base: Box): Box {
  return clampBox({ x: px - (px - b.x) / factor, y: py - (py - b.y) / factor, w: b.w / factor, h: b.h / factor }, base)
}

/**
 * The shared SVG map. Every clickable element carries `data-place-id`,
 * which hover, tooltips and drag-and-drop use to find what's under the pointer.
 */
export function MapView({ activeIds, focusIds, zoomable, classFor, labelFor, tooltipFor, onPick, onHover }: Props) {
  const { config, shapes, shapeById, callouts, places } = useDataset()
  const calloutIds = new Set(callouts.map((c) => c.id))
  const isActive = (id: string) => !activeIds || activeIds.has(id)

  // ----- View box: fits the focus, then the user can zoom/pan from there -----
  const base = parseBox(config.viewBox)
  const focusKey = focusIds && focusIds.length < places.length ? focusIds.join(',') : 'all'
  const focus = focusKey === 'all' ? base : fitBox(boundsOf(focusIds!, shapeById, callouts), base)
  // Remember the user's zoom only for the current focus, so changing region re-fits the map.
  const [zoom, setZoom] = useState<{ key: string; box: Box } | null>(null)
  const view = zoom?.key === focusKey ? zoom.box : focus
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })
  const setView = (box: Box) => setZoom({ key: focusKey, box })
  const scale = view.w / base.w

  const svgRef = useRef<SVGSVGElement>(null)
  const toMap = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return [v.x + ((clientX - r.left) / r.width) * v.w, v.y + ((clientY - r.top) / r.height) * v.h]
  }

  // Wheel zoom needs a non-passive listener so it can stop the page scrolling.
  const setViewRef = useRef(setView)
  useEffect(() => {
    setViewRef.current = setView
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!zoomable || !svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = toMap(e.clientX, e.clientY)
      setViewRef.current(zoomAt(viewRef.current, px, py, Math.exp(-e.deltaY * 0.0025), base))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // base is derived from config.viewBox, which is what actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomable, config.viewBox])

  // ----- Drag to pan, two fingers to pinch -----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    startX: number
    startY: number
    startView: Box
    panning: boolean
    pinchDist?: number
    pinchAt?: [number, number]
  } | null>(null)
  const suppressClick = useRef(false)
  const [panning, setPanning] = useState(false)

  const startGesture = () => {
    const pts = [...pointers.current.values()]
    if (pts.length === 1) {
      gesture.current = { startX: pts[0].x, startY: pts[0].y, startView: viewRef.current, panning: false }
    } else if (pts.length === 2) {
      const [a, b] = pts
      gesture.current = {
        startX: 0,
        startY: 0,
        startView: viewRef.current,
        panning: true,
        pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
        pinchAt: toMap((a.x + b.x) / 2, (a.y + b.y) / 2) as [number, number],
      }
    }
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!zoomable || (e.pointerType === 'mouse' && e.button !== 0)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    startGesture()
  }

  const onPointerMoveZoom = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!zoomable || !g || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]

    if (pts.length === 2 && g.pinchDist && g.pinchAt) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      setView(zoomAt(g.startView, g.pinchAt[0], g.pinchAt[1], dist / g.pinchDist, base))
      return
    }

    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.panning && Math.hypot(dx, dy) > 5) {
      g.panning = true
      setPanning(true)
      svgRef.current?.setPointerCapture(e.pointerId)
    }
    if (g.panning) {
      const r = svgRef.current!.getBoundingClientRect()
      const k = g.startView.w / r.width
      setView(clampBox({ ...g.startView, x: g.startView.x - dx * k, y: g.startView.y - dy * k }, base))
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    if (gesture.current?.panning) suppressClick.current = true
    setPanning(false)
    // Lifting one finger of a pinch continues as a pan from where things are now.
    if (pointers.current.size > 0) startGesture()
    else gesture.current = null
  }

  // ----- Hover + tooltip -----
  const [hovered, setHovered] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    onPointerMoveZoom(e)
    const id = gesture.current?.panning
      ? null
      : ((e.target as Element).closest('[data-place-id]')?.getAttribute('data-place-id') ?? null)
    if (id !== hovered) {
      setHovered(id)
      onHover?.(id)
    }
    // Position the tooltip directly to avoid re-rendering the map on every mouse move.
    const wrap = wrapRef.current?.getBoundingClientRect()
    if (wrap && tipRef.current) {
      tipRef.current.style.transform = `translate(${e.clientX - wrap.left}px, ${e.clientY - wrap.top}px)`
    }
  }

  const clearHover = () => {
    if (hovered) onHover?.(null)
    setHovered(null)
  }

  const tooltip = hovered && canHover() ? tooltipFor?.(hovered) : undefined

  // ----- Rendering -----
  const handlers = (id: string) => (isActive(id) ? { 'data-place-id': id, onClick: () => onPick?.(id) } : {})
  const cls = (id: string) => `place ${isActive(id) ? (classFor?.(id) ?? '') : 'dim'}`
  // Labels shrink in map units as you zoom in, so they grow only gently on screen.
  const labelSize = 10 * Math.pow(scale, 0.7)

  const zoomBy = (factor: number) => setView(zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, factor, base))
  const isFitted = view.x === focus.x && view.y === focus.y && view.w === focus.w

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`map ${zoomable ? 'zoomable' : ''} ${panning ? 'panning' : ''}`}
        style={{ aspectRatio: `${base.w} / ${base.h}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-label={`Map of ${config.title}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={clearHover}
        onClickCapture={(e) => {
          // A drag-to-pan shouldn't also count as clicking the place it ended on.
          if (suppressClick.current) {
            suppressClick.current = false
            e.stopPropagation()
          }
        }}
      >
        <g>
          {shapes.map((s) => (
            <path key={s.id} d={s.d} className={cls(s.id)} {...handlers(s.id)} />
          ))}
        </g>

        <g className="callouts" style={{ fontSize: Math.min(10, labelSize * 1.3) }}>
          {callouts.map((c) => {
            const label = isActive(c.id) ? labelFor?.(c.id) : undefined
            return (
              <g key={c.id}>
                <line className="leader" x1={c.x} y1={c.y + c.height / 2} x2={c.target[0]} y2={c.target[1]} />
                <rect
                  x={c.x}
                  y={c.y}
                  width={c.width}
                  height={c.height}
                  rx={4}
                  className={cls(c.id)}
                  {...handlers(c.id)}
                />
                {label && (
                  <text className="label" x={c.x + c.width / 2} y={c.y + c.height / 2}>
                    {label}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        <g style={{ fontSize: labelSize }}>
          {shapes.map((s) => {
            if (calloutIds.has(s.id) || !isActive(s.id)) return null
            const label = labelFor?.(s.id)
            return label ? (
              <text key={s.id} className="label" x={s.label[0]} y={s.label[1]}>
                {label}
              </text>
            ) : null
          })}
        </g>
      </svg>

      <div ref={tipRef} className={`tooltip ${tooltip ? 'show' : ''}`} aria-hidden>
        <span>{tooltip}</span>
      </div>

      {zoomable && (
        <div className="zoom-controls">
          <button aria-label="Zoom in" onClick={() => zoomBy(BUTTON_STEP)} disabled={scale <= 1 / MAX_ZOOM + 1e-9}>
            +
          </button>
          <button aria-label="Zoom out" onClick={() => zoomBy(1 / BUTTON_STEP)} disabled={scale >= 1}>
            −
          </button>
          <button aria-label="Fit map" title="Fit map" onClick={() => setZoom(null)} disabled={isFitted}>
            ⤢
          </button>
        </div>
      )}
    </div>
  )
}

/** Tooltips only make sense with a hovering pointer (not on touch screens). */
function canHover(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
}
