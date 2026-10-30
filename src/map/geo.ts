import { feature, neighbors as topoNeighbors } from 'topojson-client'
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
  /** The capital's position on the map, if the place has one */
  capital?: [number, number]
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
  const placeById = Object.fromEntries(places.map((p) => [p.id, p]))
  const pointProjection = config.projection ?? config.pointProjection
  const capitalPoint = (id: string): [number, number] | undefined => {
    const loc = placeById[id]?.capitalLocation
    const xy = loc && pointProjection?.(loc)
    return xy ? [xy[0], xy[1]] : undefined
  }

  const shapes: Shape[] = feature(topology, object)
    .features.filter((f) => known.has(String(f.id)))
    .map((f) => {
      const id = String(f.id)
      const [x, y] = path.centroid(f)
      const [[x0, y0], [x1, y1]] = path.bounds(f)
      return { id, d: path(f) ?? '', label: config.labelOverrides?.[id] ?? [x, y], bounds: [x0, y0, x1, y1], area: path.area(f), capital: capitalPoint(id) }
    })

  const shapeById: Record<string, Shape> = Object.fromEntries(shapes.map((s) => [s.id, s]))

  // Places that share a border, read from the shared arcs in the topology. Shapes that aren't places
  // (e.g. DC in us-atlas) are left out, on both sides.
  const geometryIds = object.geometries.map((g) => String(g.id))
  const neighborIds: Record<string, string[]> = {}
  topoNeighbors(object.geometries).forEach((adjacent, i) => {
    const id = geometryIds[i]
    if (!known.has(id)) return
    neighborIds[id] = [...new Set(adjacent.map((j) => geometryIds[j]).filter((n) => known.has(n) && n !== id))]
  })

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

  return { shapes, shapeById, callouts, neighbors: neighborIds }
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
