import { feature } from 'topojson-client'
import { geoPath } from 'd3-geo'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { DatasetConfig, Place } from '../datasets/types'

export type Shape = {
  id: string
  d: string
  label: [number, number]
  /** [x0, y0, x1, y1] in map coordinates */
  bounds: Bounds
  area: number
}

export type Bounds = [number, number, number, number]

export type Callout = {
  id: string
  x: number
  y: number
  width: number
  height: number
  target: [number, number]
}

/** Turns a topology into SVG path data and label points for the places in the dataset. */
export function buildMap(config: DatasetConfig, topology: Topology, places: Place[]) {
  const object = topology.objects[config.objectName] as GeometryCollection
  const path = geoPath(config.projection ?? null)
  const known = new Set(places.map((p) => p.id))

  const shapes: Shape[] = feature(topology, object)
    .features.filter((f) => known.has(String(f.id)))
    .map((f) => {
      const id = String(f.id)
      const [x, y] = path.centroid(f)
      const [[x0, y0], [x1, y1]] = path.bounds(f)
      return { id, d: path(f) ?? '', label: config.labelOverrides?.[id] ?? [x, y], bounds: [x0, y0, x1, y1], area: path.area(f) }
    })

  const shapeById: Record<string, Shape> = Object.fromEntries(shapes.map((s) => [s.id, s]))

  const layout = config.callouts
  const callouts: Callout[] = layout
    ? layout.ids.map((id, i) => ({
        id,
        x: layout.x,
        y: layout.top + i * layout.gap,
        width: layout.width,
        height: layout.height,
        target: shapeById[id].label,
      }))
    : []

  return { shapes, shapeById, callouts }
}

/** Smallest box containing the given places, including their callout boxes. */
export function boundsOf(ids: string[], shapeById: Record<string, Shape>, callouts: Callout[]): Bounds {
  const boxes: Bounds[] = ids.map((id) => shapeById[id].bounds)
  for (const c of callouts) {
    if (ids.includes(c.id)) boxes.push([c.x, c.y, c.x + c.width, c.y + c.height])
  }
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
}
