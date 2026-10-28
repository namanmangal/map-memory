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
  /** Where the capital is, as [longitude, latitude] — shown as a star on the Explore map */
  capitalLocation?: [number, number]
  /** Used for "practice one region" filters, e.g. a US census region or a continent */
  group: string
  /** Free-form extras shown on the Explore info card, in order */
  facts?: Record<string, string>
  /** Photos shown on the Explore info card (loaded from the dataset's images file) */
  images?: PlaceImage[]
}

/** A freely licensed photo hosted on Wikimedia Commons, with what's needed to credit it. */
export type PlaceImage = {
  /** What it shows, e.g. "State flower" or "Landmark" */
  kind: string
  caption: string
  /** Gallery image (500px wide) */
  src: string
  /** Larger version (up to 1280px wide) for the full-size view */
  large: string
  width: number
  height: number
  /** Photographer, or "Public domain" */
  credit: string
  license: string
  licenseUrl: string
  /** The file's Wikimedia Commons page */
  source: string
  /** Wikipedia article about the subject */
  article: string
  /** A graphic such as a flag: shown whole on a plain background instead of a blurred photo backdrop */
  plain?: boolean
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
  /**
   * For pre-projected maps: the projection the shapes were drawn with, used to place points
   * such as capitals. Not needed when `projection` is set.
   */
  pointProjection?: GeoProjection
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
  /** Photos per place id; optional, and loaded alongside the places */
  loadImages?: () => Promise<Record<string, PlaceImage[]>>
}
