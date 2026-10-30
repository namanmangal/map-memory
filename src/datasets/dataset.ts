import { createContext, useContext } from 'react'
import { buildMap, type Callout, type Shape } from '../map/geo'
import type { DatasetConfig, Place, PlaceImage } from './types'

export const ALL_GROUPS = 'All'

export type LoadedDataset = {
  config: DatasetConfig
  places: Place[]
  byId: Record<string, Place>
  shapes: Shape[]
  shapeById: Record<string, Shape>
  callouts: Callout[]
  idsForGroup: (group: string) => string[]
  /** Whether places have capitals (enables the Capitals quiz and capital UI) */
  hasCapitals: boolean
  /** Places sharing a border with each place (none for islands), used to pick confusable wrong answers */
  neighbors: Record<string, string[]>
  /** Distance between label points, used to pick nearby wrong answers when there aren't enough neighbors */
  distance: (a: string, b: string) => number
}

export async function loadDataset(config: DatasetConfig): Promise<LoadedDataset> {
  const [topology, loadedPlaces, images] = await Promise.all([
    config.loadTopology(),
    config.loadPlaces(),
    // Photos are optional extras: if they fail to load, the map still works without them.
    (config.loadImages?.() ?? Promise.resolve<Record<string, PlaceImage[]>>({})).catch((e: unknown) => {
      console.warn('Photos unavailable:', e)
      return {} as Record<string, PlaceImage[]>
    }),
  ])
  const places = loadedPlaces.map((p) => (images[p.id] ? { ...p, images: images[p.id] } : p))
  const { shapes, shapeById, callouts, neighbors } = buildMap(config, topology, places)
  return {
    config,
    places,
    byId: Object.fromEntries(places.map((p) => [p.id, p])),
    shapes,
    shapeById,
    callouts,
    idsForGroup: (group) => places.filter((p) => group === ALL_GROUPS || p.group === group).map((p) => p.id),
    hasCapitals: places.some((p) => p.capital),
    neighbors,
    distance: (a, b) => {
      const [ax, ay] = shapeById[a].label
      const [bx, by] = shapeById[b].label
      return Math.hypot(ax - bx, ay - by)
    },
  }
}

export const DatasetContext = createContext<LoadedDataset | null>(null)

export function useDataset(): LoadedDataset {
  const ds = useContext(DatasetContext)
  if (!ds) throw new Error('useDataset must be used inside a loaded DatasetContext')
  return ds
}
