import { createContext, useContext } from 'react'
import { buildMap, type Callout, type Shape } from '../map/geo'
import type { DatasetConfig, Place } from './types'

export const ALL_GROUPS = 'All'

export type LoadedDataset = {
  config: DatasetConfig
  places: Place[]
  byId: Record<string, Place>
  shapes: Shape[]
  shapeById: Record<string, Shape>
  callouts: Callout[]
  idsForGroup: (group: string) => string[]
  /** Distance between label points, used to pick nearby (confusable) wrong answers */
  distance: (a: string, b: string) => number
}

export async function loadDataset(config: DatasetConfig): Promise<LoadedDataset> {
  const [topology, places] = await Promise.all([config.loadTopology(), config.loadPlaces()])
  const { shapes, shapeById, callouts } = buildMap(config, topology, places)
  return {
    config,
    places,
    byId: Object.fromEntries(places.map((p) => [p.id, p])),
    shapes,
    shapeById,
    callouts,
    idsForGroup: (group) => places.filter((p) => group === ALL_GROUPS || p.group === group).map((p) => p.id),
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
