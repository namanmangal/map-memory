import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
  /** Accessible name for a state when it's a keyboard-focusable button (only when `onPick` is set) */
  ariaLabelFor?: (id: string) => string
  /**
   * Which states can be picked right now (e.g. not before a quiz starts, not already answered).
   * Only these are keyboard buttons; defaults to every active state.
   */
  canPick?: (id: string) => boolean
  onPick?: (id: string) => void
  onHover?: (id: string | null) => void
  /**
   * Centers on place `id`, zoomed to the level that fits `levelOf` (e.g. its region), or to the
   * place itself if omitted. With no `id`, zooms back out to the starting view.
   * Bump `nonce` to apply it again.
   */
  zoomTarget?: { id?: string; nonce: number; levelOf?: string[] } | null
  /** Called with true when the map is at its starting view (full map or region), false once zoomed or panned away */
  onViewChange?: (atStart: boolean) => void
  /** Draw a star at each place's capital */
  showCapitals?: boolean
  /** A place whose capital name is always shown (e.g. the selected one); otherwise names appear once zoomed in */
  namedCapital?: string | null
}

type Box = { x: number; y: number; w: number; h: number }

const MAX_ZOOM = 8
/** Every capital's name is shown once zoomed in at least this far (scale = view width / full width) */
const CAPITAL_NAMES_SCALE = 0.4

/**
 * Width of a capital name, measured exactly as the map draws it: a hidden SVG <text> with the same
 * class and the same font size, so placement, collision checks and the visible tag all agree. (The
 * size matters: system fonts like SF Pro draw small text wider than large text.) Cached.
 */
const textWidths = new Map<string, number>()
let measureText: SVGTextElement | undefined
function capitalNameWidth(text: string, fontSize: number): number {
  const key = `${fontSize.toFixed(2)}|${text}`
  const cached = textWidths.get(key)
  if (cached !== undefined) return cached
  if (!measureText) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'
    measureText = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    measureText.setAttribute('class', 'capital-name')
    svg.appendChild(measureText)
    document.body.appendChild(svg)
  }
  measureText.style.fontSize = `${fontSize}px`
  measureText.textContent = text
  const width = measureText.getBBox().width || text.length * 0.64 * fontSize
  textWidths.set(key, width)
  return width
}

/** A five-pointed star centered on (cx, cy) */
function starPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = (Math.PI / 5) * i - Math.PI / 2
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`
  })
  return `M${pts.join('L')}Z`
}
const BUTTON_STEP = 1.6
/** Labels are 10 map units on the full map and shrink in map units as you zoom, so they grow only gently on screen. */
const labelSizeAt = (scale: number) => 10 * Math.pow(scale, 0.7)
/** Small places only get in-shape labels once zoomed in at least this much (scale = view width / full width) */
const INLINE_LABEL_SCALE = 0.83

function parseBox(viewBox: string): Box {
  const [x, y, w, h] = viewBox.trim().split(/\s+/).map(Number)
  return { x, y, w, h }
}

/** Keeps the view inside the full map and within the zoom limits, at the map's aspect ratio. */
function clampBox(b: Box, base: Box): Box {
  const w = Math.min(Math.max(b.w, base.w / MAX_ZOOM), base.w)
  const h = (w * base.h) / base.w
  // Resize around the box's center, so hitting the zoom limit doesn't shift what's in view.
  const x = b.x + (b.w - w) / 2
  const y = b.y + (b.h - h) / 2
  return {
    x: Math.min(Math.max(x, base.x), base.x + base.w - w),
    y: Math.min(Math.max(y, base.y), base.y + base.h - h),
    w,
    h,
  }
}

/** A padded box around the bounds, widened to the map's aspect ratio. */
function fitBox([x0, y0, x1, y1]: Bounds, base: Box, padRatio = 0.08): Box {
  const pad = Math.max(x1 - x0, y1 - y0) * padRatio
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

type InsetLayout = {
  panel: Box
  transforms: Record<string, { tx: number; ty: number; s: number }>
}

/**
 * Lays inset places (Alaska, Hawaii) out in a row inside a panel in the bottom corner of
 * the focus view, on whichever side of the region has more free space.
 */
function layoutInsets(ids: string[], region: Bounds, focus: Box, shapeBounds: (id: string) => Bounds): InsetLayout {
  const gap = 20
  const pad = focus.w * 0.015
  const boxes = ids.map(shapeBounds)
  const rowW = boxes.reduce((sum, b) => sum + (b[2] - b[0]), 0) + gap * (boxes.length - 1)
  const rowH = Math.max(...boxes.map((b) => b[3] - b[1]))

  const leftFree = region[0] - focus.x
  const rightFree = focus.x + focus.w - region[2]
  const right = rightFree >= leftFree
  let s = Math.min(1, (Math.max(leftFree, rightFree) - pad * 3) / rowW, (focus.h * 0.35) / rowH)
  // No room beside the region: overlap a corner of it at a modest size instead.
  if (s < 0.3) s = Math.min(1, (focus.w * 0.35) / rowW, (focus.h * 0.3) / rowH)

  const w = rowW * s + pad * 2
  const h = rowH * s + pad * 2
  const panel = {
    x: right ? focus.x + focus.w - w - pad : focus.x + pad,
    y: focus.y + focus.h - h - pad,
    w,
    h,
  }

  const transforms: InsetLayout['transforms'] = {}
  let cursor = panel.x + pad
  ids.forEach((id, i) => {
    const [x0, y0, x1, y1] = boxes[i]
    // Bottom-align each inset in the row.
    transforms[id] = { s, tx: cursor - x0 * s, ty: panel.y + pad + (rowH - (y1 - y0)) * s - y0 * s }
    cursor += (x1 - x0 + gap) * s
  })
  return { panel, transforms }
}

/**
 * Zooms by `factor` (>1 = in) keeping the map point (px, py) fixed on screen. The factor is first
 * limited to the zoom range, so at a limit nothing moves and the same box comes back (callers use
 * that to know the wheel can scroll the page instead).
 */
function zoomAt(b: Box, px: number, py: number, factor: number, base: Box): Box {
  const w = Math.min(Math.max(b.w / factor, base.w / MAX_ZOOM), base.w)
  const f = b.w / w
  if (Math.abs(f - 1) < 1e-9) return b
  return clampBox({ x: px - (px - b.x) / f, y: py - (py - b.y) / f, w, h: (w * base.h) / base.w }, base)
}

/**
 * The shared SVG map. Every clickable element carries `data-place-id`,
 * which hover, tooltips and drag-and-drop use to find what's under the pointer.
 */
export function MapView({
  activeIds,
  focusIds,
  zoomable,
  classFor,
  labelFor,
  tooltipFor,
  ariaLabelFor,
  canPick,
  onPick,
  onHover,
  zoomTarget,
  onViewChange,
  showCapitals,
  namedCapital,
}: Props) {
  const { config, shapes, shapeById, callouts, places, byId } = useDataset()
  const isActive = (id: string) => !activeIds || activeIds.has(id)

  // ----- View box: fits the focus, then the user can zoom/pan from there -----
  const base = parseBox(config.viewBox)
  // An empty focus (e.g. a region with nothing to ask) shows the whole map rather than fitting to nothing.
  const focusKey = focusIds && focusIds.length > 0 && focusIds.length < places.length ? focusIds.join(',') : 'all'
  const focusList = focusKey === 'all' ? null : focusIds!
  // Insets in a region get moved next to it, so fit to the rest of the region only.
  const insetIds = new Set(config.insets ?? [])
  const mainland = focusList?.filter((id) => !insetIds.has(id)) ?? []
  const movedInsets = mainland.length ? focusList!.filter((id) => insetIds.has(id)) : []

  /** A small place's label goes inside it (instead of a callout box) once the shape is big enough on screen. */
  const fitsInside = (id: string, scale: number) => {
    if (scale > INLINE_LABEL_SCALE) return false
    const { area, bounds } = shapeById[id]
    const size = Math.min(Math.sqrt(area), bounds[2] - bounds[0], bounds[3] - bounds[1])
    return size >= 1.8 * labelSizeAt(scale)
  }

  /** Fits a region: first to its places alone, then making room for any callout boxes the zoomed view still needs. */
  const fitRegion = (ids: string[]): { bounds: Bounds; box: Box } => {
    let bounds = boundsOf(ids, shapeById, [])
    let box = fitBox(bounds, base)
    const needed = callouts.filter((c) => ids.includes(c.id) && !fitsInside(c.id, box.w / base.w))
    if (needed.length) {
      bounds = boundsOf(ids, shapeById, needed)
      box = fitBox(bounds, base)
    }
    return { bounds, box }
  }
  /** Insets sit far from the rest of their region, so regions are fitted without them. */
  const withoutInsets = (ids: string[]) => {
    const rest = ids.filter((id) => !insetIds.has(id))
    return rest.length ? rest : ids
  }

  const region = focusList ? fitRegion(withoutInsets(focusList)) : null
  const focusBounds = region?.bounds ?? null
  const focus = region?.box ?? base
  const insets = movedInsets.length
    ? layoutInsets(movedInsets, focusBounds!, focus, (id) => shapeById[id].bounds)
    : null
  /** A map point, moved along with its place when that place is shown as an inset */
  const placePoint = (id: string, [x, y]: [number, number]): [number, number] => {
    const t = insets?.transforms[id]
    return t ? [x * t.s + t.tx, y * t.s + t.ty] : [x, y]
  }
  const labelPoint = (id: string) => placePoint(id, shapeById[id].label)
  // Remember the user's zoom only for the current focus, so changing region re-fits the map.
  const [zoom, setZoom] = useState<{ key: string; box: Box } | null>(null)
  const view = zoom?.key === focusKey ? zoom.box : focus
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })
  const setView = (box: Box) => setZoom({ key: focusKey, box })
  const scale = view.w / base.w

  // Zoom to a requested place (adjusting state during render is React's pattern for reacting to a prop change).
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null)
  if (zoomTarget && zoomTarget.nonce !== appliedNonce) {
    setAppliedNonce(zoomTarget.nonce)
    if (!zoomTarget.id) {
      setZoom(null)
    } else {
      zoomToPlace(zoomTarget.id, zoomTarget.levelOf)
    }
  }

  function zoomToPlace(id: string, levelOf?: string[]) {
    const b = shapeById[id].bounds
    const t = insets?.transforms[id]
    const placed: Bounds = t ? [b[0] * t.s + t.tx, b[1] * t.s + t.ty, b[2] * t.s + t.tx, b[3] * t.s + t.ty] : b
    if (levelOf) {
      const { w, h } = fitRegion(withoutInsets(levelOf)).box
      const cx = (placed[0] + placed[2]) / 2
      const cy = (placed[1] + placed[3]) / 2
      setView(clampBox({ x: cx - w / 2, y: cy - h / 2, w, h }, base))
    } else {
      setView(fitBox(placed, base, 0.2))
    }
  }

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
      const [px, py] = toMap(e.clientX, e.clientY)
      const current = viewRef.current
      const next = zoomAt(current, px, py, Math.exp(-e.deltaY * 0.0025), base)
      // Already at the zoom limit in this direction: let the page scroll instead of swallowing the wheel.
      const same = Math.abs(next.w - current.w) < 1e-6 && Math.abs(next.x - current.x) < 1e-6 && Math.abs(next.y - current.y) < 1e-6
      if (same) return
      e.preventDefault()
      setViewRef.current(next)
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
    // A new press starts fresh: a click swallowed-to-be from an earlier pan that never got a click
    // (e.g. released outside the map) mustn't eat this one.
    if (pointers.current.size === 0) suppressClick.current = false
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
      try {
        svgRef.current?.setPointerCapture(e.pointerId)
      } catch {
        // The pointer already went away (e.g. the gesture was cancelled); panning still works without capture.
      }
    }
    if (g.panning) {
      const r = svgRef.current!.getBoundingClientRect()
      const k = g.startView.w / r.width
      setView(clampBox({ ...g.startView, x: g.startView.x - dx * k, y: g.startView.y - dy * k }, base))
    }
  }

  /** Releasing a pointer; a pan that just ended shouldn't also count as a click. */
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    if (gesture.current?.panning) suppressClick.current = true
    endPointer()
  }

  /** A cancelled pointer (e.g. the browser took over the gesture) only clears gesture state. */
  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    endPointer()
  }

  const endPointer = () => {
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
  /**
   * The state's own shape is its keyboard control: focusable, announced, and picked with Enter or
   * Space. Other click targets for the same place (callout box, star, hit area) stay mouse-only.
   */
  const keyboard = (id: string) =>
    isActive(id) && onPick && (canPick?.(id) ?? true)
      ? {
          tabIndex: 0,
          role: 'button',
          'aria-label': ariaLabelFor?.(id) ?? byId[id].name,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onPick(id)
            }
          },
        }
      : {}
  const mouseOnly = { 'aria-hidden': true }
  const cls = (id: string) => `place ${isActive(id) ? (classFor?.(id) ?? '') : 'dim'}`
  // Island groups like Hawaii are mostly ocean, so insets get a click area covering their whole box.
  const hitArea = (id: string) => {
    if (!insetIds.has(id) || !isActive(id)) return null
    const [x0, y0, x1, y1] = shapeById[id].bounds
    return <rect className="hit-area" x={x0} y={y0} width={x1 - x0} height={y1 - y0} {...handlers(id)} {...mouseOnly} />
  }
  const labelSize = labelSizeAt(scale)
  const shownCallouts = callouts.filter((c) => !fitsInside(c.id, scale))
  const boxedIds = new Set(shownCallouts.map((c) => c.id))
  const capitals = showCapitals ? layoutCapitals() : null

  // Fit each capital's tag to its name as actually drawn (before paint), with even padding. The
  // layout's estimate is used for collision checks; this makes the visible tag snug and centered.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    for (const tag of svg.querySelectorAll<SVGGElement>('.capital-tag')) {
      const text = tag.querySelector('text')
      const rect = tag.querySelector('rect')
      if (!text || !rect) continue
      const box = text.getBBox()
      const padX = Number(tag.dataset.pad)
      rect.setAttribute('x', String(box.x - padX))
      rect.setAttribute('width', String(box.width + padX * 2))
    }
  })

  /**
   * Places capital stars and names so nothing covers anything else: a state label that would sit
   * on a star moves just below or above it, and each name takes the first spot (right, left,
   * above, below, or diagonally right) clear of labels, other names and other stars.
   */
  function layoutCapitals() {
    const fs = labelSize // state label size
    const nameFs = labelSize * 0.95
    const r = labelSize * 0.55
    type Rect = [number, number, number, number]
    const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
    const overlapArea = (a: Rect, b: Rect) =>
      Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
    /** Lowest-cost option: covering text costs far more than covering a star. */
    const leastCovering = <T,>(options: T[], rectOf: (o: T) => Rect, text: Rect[], marks: Rect[]): T => {
      const cost = (o: T) => {
        const box = rectOf(o)
        return text.reduce((sum, t) => sum + overlapArea(box, t) * 10, 0) + marks.reduce((sum, m) => sum + overlapArea(box, m), 0)
      }
      return options.reduce((best, o) => (cost(o) < cost(best) ? o : best))
    }
    // Rough text extents: bold caps ~0.7em per letter, italic names ~0.58em per letter. Rendered
    // text boxes are ~1.2em tall, plus a little padding so near-misses count as collisions.
    const pad = fs * 0.1
    const labelRect = ([x, y]: [number, number], text: string): Rect => {
      const w = text.length * 0.7 * fs
      const h = fs * 1.2
      return [x - w / 2 - pad, y - h / 2 - pad, x + w / 2 + pad, y + h / 2 + pad]
    }

    const stars: Record<string, [number, number]> = {}
    const labelPos: Record<string, [number, number]> = {}
    const names: { id: string; text: string; x: number; y: number; rect: Rect }[] = []
    const taken: Rect[] = []

    for (const s of shapes) {
      if (s.capital && isActive(s.id)) stars[s.id] = placePoint(s.id, s.capital)
    }
    const starRect = ([x, y]: [number, number]): Rect => [x - r, y - r, x + r, y + r]
    const starRects = Object.entries(stars).map(([id, p]) => ({ id, rect: starRect(p) }))

    // State labels: stay put unless that covers any star; then try just below/above it.
    for (const s of shapes) {
      const label = boxedIds.has(s.id) || !isActive(s.id) ? undefined : labelFor?.(s.id)
      if (!label) continue
      const [lx, ly] = labelPoint(s.id)
      const own = stars[s.id]
      // Far enough from the star's center that the label's (padded) box clears it.
      const clearance = r + fs * 0.6 + pad + fs * 0.05
      const candidates: [number, number][] = [
        [lx, ly],
        ...(own ? ([[lx, own[1] + clearance], [lx, own[1] - clearance]] as [number, number][]) : []),
        [lx, ly + fs * 1.1],
        [lx, ly - fs * 1.1],
        // sideways too, for tight spots (e.g. MA next to Providence)
        [lx - label.length * 0.7 * fs, ly],
        [lx + label.length * 0.7 * fs, ly],
      ]
      const starBoxes = starRects.map((st) => st.rect)
      const pos =
        candidates.find((c) => !starBoxes.some((st) => overlaps(st, labelRect(c, label)))) ??
        leastCovering(candidates, (c) => labelRect(c, label), taken, starBoxes)
      labelPos[s.id] = pos
      taken.push(labelRect(pos, label))
    }

    for (const s of shapes) {
      const star = stars[s.id]
      const text = byId[s.id].capital
      if (!star || !text || !(s.id === namedCapital || scale <= CAPITAL_NAMES_SCALE)) continue
      const [x, y] = star
      // The box is also the name's visible tag: the name's measured width plus even padding.
      const padX = nameFs * 0.3
      const w = capitalNameWidth(text, nameFs) + padX * 2
      const h = nameFs * 1.2 + pad * 2
      const gap = r * 1.4
      const spots = [
        { rect: [x + gap, y - h / 2, x + gap + w, y + h / 2] as Rect }, // right
        { rect: [x - gap - w, y - h / 2, x - gap, y + h / 2] as Rect }, // left
        { rect: [x - w / 2, y - gap - h, x + w / 2, y - gap] as Rect }, // above
        { rect: [x - w / 2, y + gap, x + w / 2, y + gap + h] as Rect }, // below
        { rect: [x + gap * 0.7, y - gap - h, x + gap * 0.7 + w, y - gap] as Rect }, // above right
        { rect: [x + gap * 0.7, y + gap, x + gap * 0.7 + w, y + gap + h] as Rect }, // below right
      ]
      // Clear of labels, names already placed, and every other capital's star; failing that, a name
      // may cover a neighbor's star but never a label or another name.
      const otherStars = starRects.filter((st) => st.id !== s.id).map((st) => st.rect)
      const clear = (p: { rect: Rect }, blockers: Rect[]) => !blockers.some((t) => overlaps(t, p.rect))
      const spot =
        spots.find((p) => clear(p, [...taken, ...otherStars])) ??
        spots.find((p) => clear(p, taken)) ??
        leastCovering(spots, (p) => p.rect, taken, otherStars)
      taken.push(spot.rect)
      // Text is centered in its tag, so the padding is even on both sides.
      const [rx0, ry0, rx1, ry1] = spot.rect
      names.push({ id: s.id, text, x: (rx0 + rx1) / 2, y: (ry0 + ry1) / 2, rect: spot.rect })
    }
    return { stars, labelPos, names, r, padX: labelSize * 0.95 * 0.3 }
  }

  const zoomBy = (factor: number) => setView(zoomAt(view, view.x + view.w / 2, view.y + view.h / 2, factor, base))
  const isFitted = view.x === focus.x && view.y === focus.y && view.w === focus.w
  useEffect(() => {
    onViewChange?.(isFitted)
    // Only report changes; the callback's identity doesn't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFitted])

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`map ${zoomable ? 'zoomable' : ''} ${panning ? 'panning' : ''}`}
        style={{ aspectRatio: `${base.w} / ${base.h}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        // With clickable states the map is a group of controls; otherwise it's a picture.
        role={onPick ? 'group' : 'img'}
        aria-label={`Map of ${config.title}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
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
          {shapes.map((s) =>
            insets?.transforms[s.id] ? null : (
              <g key={s.id}>
                {hitArea(s.id)}
                <path d={s.d} className={cls(s.id)} {...handlers(s.id)} {...keyboard(s.id)} />
              </g>
            ),
          )}
        </g>

        {insets && (
          <g>
            <rect
              className="inset-panel"
              x={insets.panel.x}
              y={insets.panel.y}
              width={insets.panel.w}
              height={insets.panel.h}
              rx={6}
            />
            {movedInsets.map((id) => {
              const t = insets.transforms[id]
              return (
                <g key={id} transform={`translate(${t.tx} ${t.ty}) scale(${t.s})`}>
                  {hitArea(id)}
                  <path d={shapeById[id].d} className={cls(id)} {...handlers(id)} {...keyboard(id)} />
                </g>
              )
            })}
          </g>
        )}

        <g className="callouts" style={{ fontSize: Math.min(10, labelSize * 1.3) }}>
          {shownCallouts.map((c) => {
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
                  {...mouseOnly}
                  {...handlers(c.id)}
                />
                {label && (
                  <text className={`label ${classFor?.(c.id) ?? ''}`} x={c.x + c.width / 2} y={c.y + c.height / 2}>
                    {label}
                  </text>
                )}
              </g>
            )
          })}
        </g>

        <g style={{ fontSize: labelSize }}>
          {shapes.map((s) => {
            if (boxedIds.has(s.id) || !isActive(s.id)) return null
            const label = labelFor?.(s.id)
            const [x, y] = capitals?.labelPos[s.id] ?? labelPoint(s.id)
            return label ? (
              // The state's class (selected, result, mastery…) lets the label pick a readable color for that fill.
              <text key={s.id} className={`label ${classFor?.(s.id) ?? ''}`} x={x} y={y}>
                {label}
              </text>
            ) : null
          })}
        </g>

        {capitals && (
          // Stars keep a steady on-screen size; names show for the chosen place, or for all once zoomed in.
          <g className="capitals" style={{ fontSize: labelSize * 0.95 }}>
            {Object.entries(capitals.stars).map(([id, [x, y]]) => (
              <path key={id} className="capital-star" d={starPath(x, y, capitals.r)} {...handlers(id)} {...mouseOnly} />
            ))}
            {capitals.names.map((n) => (
              // A small tag behind the name keeps it readable on any state color, or over the ocean.
              <g key={n.id} className="capital-tag" data-pad={capitals.padX}>
                <rect
                  x={n.rect[0]}
                  y={n.rect[1]}
                  width={n.rect[2] - n.rect[0]}
                  height={n.rect[3] - n.rect[1]}
                  rx={(n.rect[3] - n.rect[1]) / 3}
                />
                <text className="capital-name" x={n.x} y={n.y} textAnchor="middle">
                  {n.text}
                </text>
              </g>
            ))}
          </g>
        )}
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
