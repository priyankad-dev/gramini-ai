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
/**
 * Which message explains this getUserMedia failure. Returns a key into `t`.
 *
 * Every failure used to say "please allow permission", including a camera that
 * was busy in another app or a site the browser had already blocked - where
 * "allow" is not even offered, because a blocked site gets no prompt at all.
 */
async function cameraErrorKey(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError': {
      // Chrome on Windows/macOS reports the OS privacy switch this way.
      if (/system/i.test(err.message || '')) return 'cameraSystemBlocked'
      // 'denied' means the site is blocked in the browser and only the user can
      // undo it from the address bar; anything else was a dismissed prompt.
      try {
        const status = await navigator.permissions?.query({ name: 'camera' })
        if (status?.state === 'denied') return 'cameraBlocked'
      } catch {
        // Safari and Firefox cannot query 'camera'.
      }
      return 'cameraDenied'
    }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'cameraNotFound'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'cameraInUse'
    case 'SecurityError':
      return 'cameraInsecure'
    case 'TypeError':
      return 'cameraUnavailable'
    default:
      return 'cameraUnknown'
  }
}

/**
 * Rear camera first; then any camera.
 *
 * `ideal` never fails on its own, but some devices still refuse the facing
 * hint (OverconstrainedError) or fail to start the camera it picks
 * (NotReadableError on laptops that also expose an IR camera). Plain
 * `video: true` lets the browser choose whatever works.
 */
async function openCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
  } catch (err) {
    if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotReadableError']
      .includes(err?.name)) throw err
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  }
}

export function VisionMode({ open, onClose, onCapture, busy }) {
  const { t } = useLang()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  // A key into `t`, not a string: storing the text made the camera effect
  // depend on the language, so switching language restarted the camera.
  const [error, setError] = useState(null)
  // Bumped by "Try again" to request the camera once more.
  const [attempt, setAttempt] = useState(0)
  // The captured frame, held for review until the user asks for analysis.
  const [shot, setShot] = useState(null)
  const [notice, setNotice] = useState(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    setShot(null)
    setNotice(null)
    setError(null)
    if (!open) {
      stop()
      return undefined
    }

    let cancelled = false

    // Browsers only expose the camera on https or localhost. Opening the dev
    // server from a phone at http://192.168.x.x leaves mediaDevices undefined,
    // which used to fail silently into a black screen.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'cameraUnavailable' : 'cameraInsecure')
      return undefined
    }

    openCamera()
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.play().catch(() => {})
        }
      })
      .catch(async (err) => {
        console.warn('[camera] getUserMedia failed:', err?.name, err?.message)
        const key = await cameraErrorKey(err)
        if (!cancelled) setError(key)
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [open, attempt, stop])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setNotice(t.cameraNotReady)
      return
    }

    const canvas = document.createElement('canvas')
    // Downscale before upload: village uplinks are slow and Gemini does not
    // need a 12-megapixel frame to read a medicine strip.
    const maxWidth = 1024
    const scale = Math.min(1, maxWidth / video.videoWidth)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    // An empty canvas encodes as "data:," - nothing worth sending.
    if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length < 1000) {
      setNotice(t.imageErrBadImage)
      return
    }
    setNotice(null)
    setShot(dataUrl)
  }

  const analyze = () => {
    if (shot && !busy) onCapture(shot)
  }

  const retake = () => {
    setShot(null)
    setNotice(null)
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
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="max-w-sm text-base leading-relaxed text-white">
              {t[error] || t.cameraUnknown}
            </p>
            {!['cameraInsecure', 'cameraUnavailable'].includes(error) && (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="min-h-tap rounded-composer border border-white/60 px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-white/10"
              >
                ↻ {t.cameraRetry}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Kept mounted under the preview so "Retake" resumes instantly. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${shot ? 'invisible' : ''}`}
            />
            {shot && (
              <img
                src={shot}
                alt=""
                className={`absolute inset-0 h-full w-full object-contain ${busy ? 'opacity-60' : ''}`}
              />
            )}
          </>
        )}
      </div>

      <div className="mx-auto w-full max-w-thread p-4">
        {(busy || notice) && (
          <p aria-live="polite" className="mb-2.5 text-center text-sm text-muted">
            {busy ? t.cameraReading : notice}
          </p>
        )}
        {shot ? (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={retake}
              disabled={busy}
              className="flex min-h-tap flex-1 items-center justify-center gap-2 rounded-composer border border-line py-3 text-base font-semibold text-ink transition-colors hover:bg-hover disabled:opacity-50"
            >
              <span aria-hidden="true">↺</span> {t.cameraRetake}
            </button>
            <button
              type="button"
              onClick={analyze}
              disabled={busy}
              aria-busy={busy}
              className="flex min-h-tap flex-[2] items-center justify-center gap-2 rounded-composer bg-ink py-3 text-base font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <span aria-hidden="true">{busy ? '⏳' : '🔍'}</span>
              {busy ? t.cameraReading : t.cameraAnalyze}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={capture}
            disabled={Boolean(error) || busy}
            className="flex min-h-tap w-full items-center justify-center gap-2 rounded-composer bg-ink py-3 text-base font-semibold text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true">📸</span> {t.cameraCapture}
          </button>
        )}
      </div>
    </div>
  )
}
