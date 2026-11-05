import { useRegisterSW } from 'virtual:pwa-register/react'

/** How often an open app checks for a new version; installed apps can stay open for days. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * Registers the service worker that keeps the app working offline, and says when a new version is
 * ready. It never reloads by itself, since that would end a quiz in progress; if the notice is
 * dismissed or ignored, the new version takes over the next time the app is opened.
 */
export function UpdateNotice() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update().catch(() => {}), CHECK_EVERY_MS)
    },
  })

  if (!needRefresh) return null
  return (
    <p className="daily-notice" role="status">
      A new version of Map Memory is ready. Reloading ends a quiz in progress (the daily challenge continues
      where it was).{' '}
      <button className="link" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>{' '}
      <button className="link" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </p>
  )
}
