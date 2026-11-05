import { describe, expect, it } from 'vitest'
import { formatTime, levenshtein, normalize, shuffle } from './util'

describe('normalize', () => {
  it('ignores case, accents, punctuation and extra spaces', () => {
    expect(normalize('  New   York. ')).toBe('new york')
    expect(normalize('São Tomé')).toBe('sao tome')
    expect(normalize("Coeur d'Alene")).toBe('coeur dalene')
  })
})

describe('levenshtein', () => {
  it('counts single-letter edits', () => {
    expect(levenshtein('ohio', 'ohio')).toBe(0)
    expect(levenshtein('ohoi', 'ohio')).toBe(2)
    expect(levenshtein('texs', 'texas')).toBe(1)
    expect(levenshtein('', 'utah')).toBe(4)
  })
})

describe('formatTime', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(47_900)).toBe('0:47')
    expect(formatTime(125_000)).toBe('2:05')
  })
})

describe('shuffle', () => {
  it('returns the same items without changing the original', () => {
    const items = [1, 2, 3, 4, 5]
    const shuffled = shuffle(items)
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5])
    expect(items).toEqual([1, 2, 3, 4, 5])
  })
})
