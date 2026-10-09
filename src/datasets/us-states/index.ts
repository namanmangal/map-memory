import type { Topology } from 'topojson-specification'
import type { DatasetConfig, Place } from '../types'

// Ids are FIPS codes, which is what us-atlas uses. They skip numbers (03, 07, 11=DC, 14, 43, 52),
// so the 50 states run from 01 to 56.
const usStates: DatasetConfig = {
  id: 'us-states',
  title: 'US States',
  noun: { one: 'state', many: 'states' },
  groupLabel: 'Region',
  groups: ['Northeast', 'Midwest', 'South', 'West'],
  objectName: 'states',
  // Pre-projected (Albers USA) to a 975×610 canvas; extra room on the right for callouts.
  viewBox: '-62 6 1086 604',
  labelOverrides: {
    '12': [800, 540], // Florida: center of the peninsula
    '26': [690, 190], // Michigan: lower peninsula
    '22': [565, 482], // Louisiana
    '15': [292, 552], // Hawaii
    '02': [110, 530], // Alaska
    '54': [764, 290], // West Virginia
  },
  callouts: {
    // VT, NH, MA, RI, CT, NJ, DE, MD — ordered north to south
    ids: ['50', '33', '25', '44', '09', '34', '10', '24'],
    x: 968,
    top: 108,
    gap: 26,
    width: 48,
    height: 20,
  },
  insets: ['02', '15'], // Alaska, Hawaii
  loadTopology: () => import('us-atlas/states-albers-10m.json').then((m) => m.default as unknown as Topology),
  loadPlaces: () => import('./places.json').then((m) => m.default as Place[]),
}

export default usStates
