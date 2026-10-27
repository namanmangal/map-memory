import { useSyncExternalStore } from 'react'

/**
 * Light / dark theme. `system` follows the OS or browser setting, including live changes.
 * The resolved theme is set as `data-theme` on <html>; index.html applies it before first paint
 * (keep that inline script in sync with the key and logic here).
 */

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'map-memory:theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

let pref: ThemePref = read()

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply() {
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

media.addEventListener('change', () => {
  if (pref === 'system') apply()
})
apply()

export function setThemePref(next: ThemePref) {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Storage unavailable — the choice just won't be remembered.
  }
  apply()
  listeners.forEach((l) => l())
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => pref,
  )
}
