/** Checking typed answers in the Name it and Capitals quizzes. */
import { levenshtein, normalize } from './util'

export type Check = 'right' | 'typo' | 'wrong'

/** "St. Paul" and "Saint Paul" count as the same answer. */
export const canonical = (text: string) => normalize(text).replace(/\bst\b/g, 'saint')

/**
 * Exact (ignoring case, punctuation and "St."/"Saint") is right; one letter off is a forgiven typo
 * for answers of 4+ letters (so Ohio, Iowa, Utah, Boise count) — unless what was typed is exactly
 * another place's answer, which is a real mistake, not a typo. `others` holds the other places'
 * answers, already passed through `canonical`; `code` (e.g. "TX") is also accepted, when given.
 */
export function checkTyped(answer: string, name: string, others: Set<string>, code?: string): Check {
  const a = canonical(answer)
  const n = canonical(name)
  if (a === n || (code && a === code.toLowerCase())) return 'right'
  if (n.length >= 4 && levenshtein(a, n) === 1 && !others.has(a)) return 'typo'
  return 'wrong'
}
