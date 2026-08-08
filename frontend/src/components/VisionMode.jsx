import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '../context/LanguageContext'

/**
 * The camera.
 *
 * This started life as sign-language recognition and was cut. Indian Sign
 * Language varies by region and there is no dependable off-the-shelf recogniser,
 * so the honest version would have been three rehearsed gestures on stage.
 *
 * Pointing the camera at the WORLD instead of at hands does work: a medicine
 * strip, a crop leaf, a government form. It is also closer to what a
 * low-literacy user actually needs - "read this paper for me".
 */
export function VisionMode({ open, onClose, onCapture, busy }) {
  const { t } = useLang()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!open) {
      stop()
      return undefined
    }

    let cancelled = false
    setError(null)

    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
      .catch(() => {
        if (!cancelled) setError(t.cameraDenied)
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [open, stop, t.cameraDenied])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement('canvas')
    // Downscale before upload: village uplinks are slow and Gemini does not
    // need a 12-megapixel frame to read a medicine strip.
    const maxWidth = 1024
    const scale = Math.min(1, maxWidth / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    onCapture(canvas.toDataURL('image/jpeg', 0.8))
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.cameraTitle}
      className="fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <div className="mx-auto flex w-full max-w-thread items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-base font-semibold text-ink">
          {t.cameraTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.cameraClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black">
        {error ? (
          <p role="alert" className="p-6 text-center text-base text-ink">
            {error}
          </p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="mx-auto w-full max-w-thread p-4">
        {busy && (
          <p aria-live="polite" className="mb-2.5 text-center text-sm text-muted">
            {t.cameraReading}
          </p>
        )}
        <button
          type="button"
          onClick={capture}
          disabled={Boolean(error) || busy}
          className="flex min-h-tap w-full items-center justify-center gap-2 rounded-composer bg-ink py-3 text-base font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden="true">📸</span> {t.cameraCapture}
        </button>
      </div>
    </div>
  )
}
