import { useSyncExternalStore } from 'react'

/**
 * Answer feedback sounds, synthesized with the Web Audio API (no audio files to load),
 * plus a mute setting remembered in localStorage.
 */

export type Sound = 'correct' | 'wrong'

const MUTED_KEY = 'map-memory:muted'

let muted = readMuted()
const listeners = new Set<() => void>()

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0')
  } catch {
    // Storage unavailable — the setting just won't be remembered.
  }
  listeners.forEach((l) => l())
}

/** Current mute setting, re-rendering when it changes. */
export function useMuted(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => muted,
  )
}

// Created on first use: browsers only allow audio to start after a user gesture, and every
// sound here is triggered by a click or key press.
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return null // Web Audio unsupported — stay silent
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** One note with a quick fade in and out, so it doesn't click. */
function note(
  ac: AudioContext,
  { freq, to, at, dur, type, volume }: { freq: number; to?: number; at: number; dur: number; type: OscillatorType; volume: number },
) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

export function playSound(sound: Sound) {
  if (muted) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime
  if (sound === 'correct') {
    // Bright rising two-note chime (C6 → E6)
    note(ac, { freq: 1046.5, at: t, dur: 0.14, type: 'sine', volume: 0.18 })
    note(ac, { freq: 1318.5, at: t + 0.09, dur: 0.26, type: 'sine', volume: 0.18 })
  } else {
    // Short, soft low "bonk" that drops in pitch
    note(ac, { freq: 220, to: 130, at: t, dur: 0.22, type: 'triangle', volume: 0.22 })
  }
}
