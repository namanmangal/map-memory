import { describe, expect, it } from 'vitest'
import { DAILY_COUNT, dailyIds, dateKey, resultSquares, streak, timeUntilTomorrow } from './daily'

const ids = Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(2, '0'))

describe('dailyIds', () => {
  it('picks the same places in the same order for the same map and day', () => {
    expect(dailyIds('us-states', ids, '2026-10-30')).toEqual(dailyIds('us-states', ids, '2026-10-30'))
  })

  it('picks DAILY_COUNT distinct places from the map', () => {
    const picked = dailyIds('us-states', ids, '2026-10-30')
    expect(picked).toHaveLength(DAILY_COUNT)
    expect(new Set(picked).size).toBe(DAILY_COUNT)
    for (const id of picked) expect(ids).toContain(id)
  })

  it('picks differently on another day or another map', () => {
    const today = dailyIds('us-states', ids, '2026-10-30')
    expect(dailyIds('us-states', ids, '2026-10-31')).not.toEqual(today)
    expect(dailyIds('world', ids, '2026-10-30')).not.toEqual(today)
  })

  it('uses every place when the map has fewer than DAILY_COUNT', () => {
    expect(dailyIds('small', ids.slice(0, 6), '2026-10-30').sort()).toEqual(ids.slice(0, 6))
  })

  it('spreads places evenly over a year', () => {
    const counts = new Map<string, number>()
    for (let d = 0; d < 365; d++) {
      for (const id of dailyIds('us-states', ids, dateKey(new Date(2026, 0, 1 + d)))) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    // 365 days × 10 of 50 places ≈ 73 each
    expect(Math.min(...counts.values())).toBeGreaterThan(50)
    expect(Math.max(...counts.values())).toBeLessThan(100)
  })
})

describe('dateKey', () => {
  it('uses the local calendar day', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dateKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})

describe('streak', () => {
  const days = (...d: string[]) => new Set(d)

  it('counts consecutive days ending today', () => {
    expect(streak(days('2026-10-30', '2026-10-29', '2026-10-28'), '2026-10-30')).toBe(3)
  })

  it("is still alive when today hasn't been played yet", () => {
    expect(streak(days('2026-10-29', '2026-10-28'), '2026-10-30')).toBe(2)
  })

  it('stops at a missed day', () => {
    expect(streak(days('2026-10-30', '2026-10-28'), '2026-10-30')).toBe(1)
    expect(streak(days('2026-10-28'), '2026-10-30')).toBe(0)
  })

  it('carries across months, years and daylight-saving changes', () => {
    expect(streak(days('2027-01-01', '2026-12-31', '2026-12-30'), '2027-01-01')).toBe(3)
    expect(streak(days('2026-11-02', '2026-11-01', '2026-10-31'), '2026-11-02')).toBe(3)
  })
})

describe('resultSquares', () => {
  it('shows one square per place, in the order asked', () => {
    expect(resultSquares(['a', 'b', 'c', 'd'], { a: 'first', b: 'second', c: 'third', d: 'missed' })).toBe('🟩🟨🟧🟥')
  })
})

describe('timeUntilTomorrow', () => {
  it('counts down to local midnight', () => {
    expect(timeUntilTomorrow(new Date(2026, 9, 30, 18, 48))).toBe('5h 12m')
    expect(timeUntilTomorrow(new Date(2026, 9, 30, 23, 50))).toBe('10m')
  })
})
