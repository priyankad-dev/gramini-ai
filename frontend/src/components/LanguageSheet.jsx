import { useEffect, useRef } from 'react'
import { useLang } from '../context/LanguageContext'

/**
 * Every language the app speaks, as a full-screen sheet of big tap targets.
 *
 * The designed path is still to SAY the language name. This exists because
 * voice-only access fails exactly the people the app is for: a user whose
 * accent the browser keeps mishearing, a user in a noisy room, a user who
 * cannot speak. "Say it or you cannot have it" is not accessibility.
 *
 * Each language is shown in ITS OWN SCRIPT and nothing else. A user looking for
 * Tamil is looking for the shape தமிழ் - they are not reading down a column of
 * romanised names. That is also why there is no search box: typing is the
 * barrier this whole app is built to remove.
 */
export function LanguageSheet({ open, onClose }) {
  const { t, lang, setLang, allLangs } = useLang()
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const entries = Object.values(allLangs)
  const verified = entries.filter((entry) => entry.verified !== false && ['hi', 'en', 'mr'].includes(entry.code))
  const rest = entries.filter((entry) => !['hi', 'en', 'mr'].includes(entry.code))

  const Tile = ({ entry }) => {
    const active = entry.code === lang
    return (
      <button
        type="button"
        onClick={() => {
          setLang(entry.code)
          onClose()
        }}
        aria-pressed={active}
        lang={entry.code}
        className={[
          'flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 py-3 transition-colors',
          active
            ? 'border-saffron bg-saffron text-onbrand'
            : 'border-line text-ink hover:bg-hover',
        ].join(' ')}
      >
        <span className="text-lg font-semibold leading-tight">{entry.label}</span>
        <span className={active ? 'text-xs opacity-80' : 'text-xs text-muted'}>
          {entry.english || entry.code}
        </span>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.chooseLanguage}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-thread overflow-y-auto rounded-t-3xl bg-surface p-4 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{t.chooseLanguage}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-[44px] items-center justify-center rounded-full border border-line px-4 text-sm font-medium text-muted hover:bg-hover"
          >
            {t.cameraClose}
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">{t.orJustSayIt}</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {verified.map((entry) => (
            <Tile key={entry.code} entry={entry} />
          ))}
        </div>

        <p className="mb-2 mt-4 text-sm font-medium text-muted">
          {t.machineTranslatedGroup}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rest.map((entry) => (
            <Tile key={entry.code} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  )
}
