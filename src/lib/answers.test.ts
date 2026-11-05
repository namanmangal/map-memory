import { describe, expect, it } from 'vitest'
import { canonical, checkTyped } from './answers'

// Other states' names, as the quiz passes them in
const others = new Set(['ohio', 'iowa', 'utah', 'maine', 'texas', 'kansas', 'arkansas'].map(canonical))

describe('checkTyped', () => {
  it('accepts the answer however it is cased, spaced or punctuated', () => {
    expect(checkTyped('new  york', 'New York', others)).toBe('right')
    expect(checkTyped('NEW YORK.', 'New York', others)).toBe('right')
  })

  it('treats "St." and "Saint" as the same', () => {
    expect(checkTyped('St. Paul', 'Saint Paul', others)).toBe('right')
    expect(checkTyped('saint paul', 'St. Paul', others)).toBe('right')
  })

  it('accepts the code only when it is offered', () => {
    expect(checkTyped('tx', 'Texas', others, 'TX')).toBe('right')
    expect(checkTyped('tx', 'Texas', others)).toBe('wrong')
  })

  it('forgives one wrong letter in answers of four or more letters', () => {
    expect(checkTyped('Texsa', 'Texas', others)).toBe('wrong') // two edits
    expect(checkTyped('Texs', 'Texas', others)).toBe('typo')
    expect(checkTyped('Boisee', 'Boise', others)).toBe('typo')
  })

  it("doesn't forgive typos in shorter answers", () => {
    expect(checkTyped('Rom', 'Rome', new Set())).toBe('typo') // 4 letters: forgiven
    expect(checkTyped('Bo', 'Bon', new Set())).toBe('wrong') // 3 letters: not
  })

  it("doesn't count another place's name as a typo", () => {
    // One letter off the answer, but exactly another state's name: a real mix-up, not a typo.
    expect(checkTyped('Maine', 'Maina', others)).toBe('wrong')
  })

  it('rejects a different answer', () => {
    expect(checkTyped('Nevada', 'Texas', others)).toBe('wrong')
  })
})
