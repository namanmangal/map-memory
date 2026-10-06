import type { DatasetConfig } from './types'
import usStates from './us-states'

/**
 * Every map the app can teach. Configs are tiny; the shapes and place data
 * load lazily when a dataset is opened. Add e.g. `world-countries` here later.
 */
export const DATASETS: DatasetConfig[] = [usStates]
