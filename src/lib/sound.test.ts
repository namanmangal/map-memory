import { afterEach, describe, expect, it, vi } from 'vitest'

/** A stand-in for the browser's audio that can't start: resume() fails, as when the page is being left */
class RefusingAudioContext {
  state = 'suspended'
  currentTime = 0
  destination = {}
  // A plain function, not vi.fn: a mock would handle the rejection itself (to record it), hiding the bug
  resume() {
    resumed++
    return Promise.reject(new DOMException('Navigated away from page', 'InvalidStateError'))
  }
  createOscillator() {
    return { type: '', frequency: param(), connect: (n: unknown) => n, start() {}, stop() {} }
  }
  createGain() {
    return { gain: param(), connect: (n: unknown) => n }
  }
}
const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} })
let resumed = 0

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('sounds', () => {
  it("stay silent, without an unhandled error, when the browser won't start audio", async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
    vi.stubGlobal('AudioContext', RefusingAudioContext)
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const { playSound } = await import('./sound')
      playSound('correct')
      playSound('wrong')
      // Let the refusals settle, and Node report any that nothing handled
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(resumed).toBeGreaterThan(0)
    expect(unhandled).toEqual([])
  })
})
