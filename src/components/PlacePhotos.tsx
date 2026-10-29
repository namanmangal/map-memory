import { useEffect, useRef, useState } from 'react'
import type { PlaceImage } from '../datasets/types'

/** The named author to credit, or null when there isn't one (e.g. public domain government photos). */
function authorOf(img: PlaceImage): string | null {
  const c = img.credit.trim()
  return c && c !== img.license && c !== 'Public domain' && c !== 'Unknown' ? c : null
}

/** "Photo: Jane Doe" for photos, "Image: …" for graphics such as flags. */
function byline(img: PlaceImage): string | null {
  const author = authorOf(img)
  return author ? `${img.plain ? 'Image' : 'Photo'}: ${author}` : null
}

/**
 * A row of thumbnails (e.g. flower, bird, landmark). Clicking one opens a larger view
 * with the photo's credit and license, as Wikimedia Commons' licenses require.
 */
export function PlacePhotos({ images, placeName, title }: { images: PlaceImage[]; placeName: string; title: string }) {
  // The open photo and the thumbnail buttons are tracked by src, not position, so a thumbnail
  // failing elsewhere in the row can't shift which photo is open.
  const [openSrc, setOpenSrc] = useState<string | null>(null)
  const thumbRefs = useRef(new Map<string, HTMLButtonElement>())
  // Hide any photo whose link has broken (e.g. removed from Commons) rather than show a broken image.
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const shown = images.filter((img) => !failed.has(img.src))
  // The viewer keeps the open photo even if its own thumbnail fails meanwhile.
  const viewable = images.filter((img) => !failed.has(img.src) || img.src === openSrc)
  const openIndex = openSrc === null ? -1 : viewable.findIndex((img) => img.src === openSrc)

  // Return focus to the thumbnail of the photo being viewed (or the first one left), so keyboard
  // users keep their place.
  const close = () => {
    const src = openSrc
    setOpenSrc(null)
    const thumb = (src !== null && !failed.has(src) && thumbRefs.current.get(src)) || thumbRefs.current.get(shown[0]?.src ?? '')
    thumb?.focus()
  }

  if (shown.length === 0 && openIndex === -1) return null

  // The heading lives here so the whole section disappears if every photo fails to load.
  return (
    <section className="photo-gallery" aria-label={`Photos of ${placeName}`}>
      <h2>{title}</h2>
      <ul className="photo-strip">
        {shown.map((img) => (
          <li key={img.src}>
            <button
              ref={(el) => {
                if (el) thumbRefs.current.set(img.src, el)
                else thumbRefs.current.delete(img.src)
              }}
              className={`photo-thumb ${img.plain ? 'plain' : ''}`}
              onClick={() => setOpenSrc(img.src)}
              aria-label={`${img.kind}: ${img.caption} — open larger ${img.plain ? 'image' : 'photo'}`}
            >
              {/* Blurred copy fills the tile behind the whole, uncropped photo */}
              {!img.plain && (
                <img className="photo-backdrop" src={img.src} alt="" aria-hidden loading="lazy" decoding="async" />
              )}
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
              <span className="photo-credit">{[byline(img), img.license].filter(Boolean).join(' · ')}</span>
            </div>
          </li>
        ))}
      </ul>
      {openIndex !== -1 && (
        <Lightbox
          images={viewable}
          index={openIndex}
          placeName={placeName}
          onIndex={(i) => setOpenSrc(viewable[i].src)}
          onClose={close}
        />
      )}
    </section>
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
  const [largeFailed, setLargeFailed] = useState<Set<string>>(new Set())
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
      <figure ref={figureRef} className={img.plain ? 'plain' : undefined} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="lightbox-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <img
          src={largeFailed.has(img.large) ? img.src : img.large}
          alt={`${img.kind} of ${placeName}: ${img.caption}`}
          // If the large version fails, show the gallery-size image (which already loaded) instead.
          onError={() => setLargeFailed((f) => (f.has(img.large) ? f : new Set(f).add(img.large)))}
        />
        <figcaption>
          <div className="lightbox-title">
            <span className="muted">{img.kind}</span> <strong>{img.caption}</strong>
          </div>
          <div className="lightbox-credit">
            {byline(img)}
            {img.license && (
              <>
                {byline(img) && ' · '}
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
              <button className="ghost" onClick={() => go(-1)} aria-label="Previous image">
                ‹
              </button>
              <span className="muted">
                {index + 1} / {images.length}
              </span>
              <button className="ghost" onClick={() => go(1)} aria-label="Next image">
                ›
              </button>
            </div>
          )}
        </figcaption>
      </figure>
    </div>
  )
}
