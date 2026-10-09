import type { GeoProjection } from 'd3-geo'
import type { Topology } from 'topojson-specification'

/** One learnable place on a map: a state, a country, a province… */
export type Place = {
  /** Must match the feature id in the map topology */
  id: string
  name: string
  /** Short code shown as a map label, e.g. "TX" or "FRA" */
  code: string
  capital?: string
  /** Used for "practice one region" filters, e.g. a US census region or a continent */
  group: string
  /** Free-form extras shown on the Explore info card, in order */
  facts?: Record<string, string>
}

export type CalloutLayout = {
  /** Places too small to click get a box off the map with a leader line */
  ids: string[]
  x: number
  top: number
  gap: number
  width: number
  height: number
}

/** Static description of a dataset. Heavy data is behind the load functions so it's only fetched when picked. */
export type DatasetConfig = {
  id: string
  title: string
  noun: { one: string; many: string }
  groupLabel: string
  groups: string[]
  /** Name of the object inside the topology that holds the shapes */
  objectName: string
  /** Omit when the topology is already projected to screen coordinates */
  projection?: GeoProjection
  viewBox: string
  /** Hand-tuned label positions where the geometric centroid looks off */
  labelOverrides?: Record<string, [number, number]>
  callouts?: CalloutLayout
  /**
   * Places drawn as insets far from their real position (e.g. Alaska, Hawaii).
   * When a zoomed region includes them, they're moved into a corner of the view.
   */
  insets?: string[]
  loadTopology: () => Promise<Topology>
  loadPlaces: () => Promise<Place[]>
}
