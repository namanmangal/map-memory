import { useEffect, useRef, useState } from 'react'
import type { PlaceImage } from '../datasets/types'

/**
 * A row of thumbnails (e.g. flower, bird, landmark). Clicking one opens a larger view
 * with the photo's credit and license, as Wikimedia Commons' licenses require.
 */
export function PlacePhotos({ images, placeName }: { images: PlaceImage[]; placeName: string }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Return focus to the thumbnail of the photo being viewed, so keyboard users keep their place.
  const close = () => {
    const i = openIndex
    setOpenIndex(null)
    if (i !== null) thumbRefs.current[i]?.focus()
  }
  // Hide any photo whose link has broken (e.g. removed from Commons) rather than show a broken image.
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const shown = images.filter((img) => !failed.has(img.src))
  if (shown.length === 0) return null

  return (
    <>
      <ul className="photo-strip">
        {shown.map((img, i) => (
          <li key={img.src}>
            <button
              ref={(el) => {
                thumbRefs.current[i] = el
              }}
              className="photo-thumb"
              onClick={() => setOpenIndex(i)}
              aria-label={`${img.kind}: ${img.caption} — open larger photo`}
            >
              {/* Blurred copy fills the tile behind the whole, uncropped photo */}
              <img className="photo-backdrop" src={img.src} alt="" aria-hidden loading="lazy" decoding="async" />
              <img
                className="photo-main"
                src={img.src}
                alt={`${img.kind} of ${placeName}: ${img.caption}`}
                width={img.width}
                height={img.height}
                loading="lazy"
                decoding="async"
                onError={() => setFailed((f) => new Set(f).add(img.src))}
              />
            </button>
            <div className="photo-caption">
              <span className="photo-kind">{img.kind}</span>
              <strong>{img.caption}</strong>
              <span className="photo-credit">
                Photo: {img.credit}
                {img.license && ` · ${img.license}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {openIndex !== null && shown[openIndex] && (
        <Lightbox
          images={shown}
          index={openIndex}
          placeName={placeName}
          onIndex={setOpenIndex}
          onClose={close}
        />
      )}
    </>
  )
}

function Lightbox({
  images,
  index,
  placeName,
  onIndex,
  onClose,
}: {
  images: PlaceImage[]
  index: number
  placeName: string
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const img = images[index]
  const closeRef = useRef<HTMLButtonElement>(null)
  const figureRef = useRef<HTMLElement>(null)
  const go = (step: number) => onIndex((index + step + images.length) % images.length)

  // Latest handlers for the listener below, which is attached once.
  const handlers = useRef({ go, onClose })
  useEffect(() => {
    handlers.current = { go, onClose }
  })

  // Keyboard: Esc closes, arrows step through the photos, and Tab stays inside the dialog.
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlers.current.onClose()
      else if (e.key === 'ArrowRight') handlers.current.go(1)
      else if (e.key === 'ArrowLeft') handlers.current.go(-1)
      else if (e.key === 'Tab') {
        const focusable = [...(figureRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])]
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const inside = figureRef.current?.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${img.kind}: ${img.caption}`} onClick={onClose}>
      <figure ref={figureRef} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="lightbox-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <img src={img.large} alt={`${img.kind} of ${placeName}: ${img.caption}`} />
        <figcaption>
          <div className="lightbox-title">
            <span className="muted">{img.kind}</span> <strong>{img.caption}</strong>
          </div>
          <div className="lightbox-credit">
            Photo: {img.credit}
            {img.license && (
              <>
                {' · '}
                {img.licenseUrl ? (
                  <a href={img.licenseUrl} target="_blank" rel="noreferrer">
                    {img.license}
                  </a>
                ) : (
                  img.license
                )}
              </>
            )}
            {' · '}
            <a href={img.source} target="_blank" rel="noreferrer">
              Wikimedia Commons
            </a>
            {' · '}
            <a href={img.article} target="_blank" rel="noreferrer">
              Read on Wikipedia
            </a>
          </div>
          {images.length > 1 && (
            <div className="lightbox-nav">
              <button className="ghost" onClick={() => go(-1)} aria-label="Previous photo">
                ‹
              </button>
              <span className="muted">
                {index + 1} / {images.length}
              </span>
              <button className="ghost" onClick={() => go(1)} aria-label="Next photo">
                ›
              </button>
            </div>
          )}
        </figcaption>
      </figure>
    </div>
  )
}
