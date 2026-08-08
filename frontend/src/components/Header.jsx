import { useState } from 'react'
import { useLang } from '../context/LanguageContext'
import { LanguageSheet } from './LanguageSheet'
import { StatusChip } from './StatusChip'

/**
 * A slim bar: identity on the left, state and controls on the right.
 *
 * The status chip lives here rather than in a menu because "is this working?"
 * is the question a first-time smartphone user asks most often, and hiding the
 * answer makes them tap the same button repeatedly.
 *
 * The app speaks two dozen languages; the bar shows at most four plus a button
 * that opens all of them. Twenty-four pills across the top would be a menu, and
 * menus need the reading skill this design avoids - but hiding the rest behind
 * VOICE ALONE fails the same users from the other side: anyone the browser
 * keeps mishearing, anyone in a noisy hall, anyone who cannot speak.
 */
function IconToggle({ on, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      aria-label={label}
      className={[
        'flex h-10 min-w-[2.5rem] items-center justify-center gap-1.5 rounded-full border px-2.5 text-sm font-semibold transition-colors',
        on
          ? 'border-saffron bg-saffron text-onbrand'
          : 'border-line text-muted hover:bg-hover',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function Header({
  dataStatus,
  largeText,
  onToggleLargeText,
  theme,
  onToggleTheme,
  highContrast,
  onToggleContrast,
  online = true,
  aiReady,
  usingCache,
}) {
  const { t, lang, setLang, allLangs, isVerifiedLang } = useLang()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  const pills = ['hi', 'en', 'mr']
    .filter((code) => allLangs[code])
    .concat(isVerifiedLang || !allLangs[lang] ? [] : [lang])
    .map((code) => allLangs[code])

  const hidden = Object.keys(allLangs).length - pills.length

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-thread items-center justify-between gap-2 px-3 py-2">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-saffron text-lg text-onbrand"
          >
            🌾
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-ink">
              {t.appName}
            </p>
            <StatusChip online={online} aiReady={aiReady} usingCache={usingCache} />
          </div>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <IconToggle
            on={largeText}
            onClick={onToggleLargeText}
            label={t.largeText}
          >
            <span aria-hidden="true" className="font-extrabold">A</span>
          </IconToggle>

          <IconToggle
            on={highContrast}
            onClick={onToggleContrast}
            label={t.highContrast}
          >
            <span aria-hidden="true">◐</span>
          </IconToggle>

          <IconToggle
            on={theme === 'dark'}
            onClick={onToggleTheme}
            label={theme === 'dark' ? t.lightMode : t.darkMode}
          >
            <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
          </IconToggle>

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={t.chooseLanguage}
            title={t.chooseLanguage}
            className="flex h-10 items-center gap-1 rounded-full border border-line px-3 text-sm font-bold text-ink transition-colors hover:bg-hover"
          >
            <span>{allLangs[lang]?.short || lang}</span>
            {hidden > 0 && (
              <span className="text-xs font-semibold text-faint">+{hidden}</span>
            )}
          </button>
        </div>
      </div>

      <LanguageSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {/*
        Three data states, three different things to say.
        'sample'  - nothing checked: a loud warning that cannot be dismissed,
                    because demoing unchecked money advice is the one mistake
                    this project must not make.
        'partial' - researched and corrected, some portals still to read: a quiet
                    note pointing at the government link, which is what the user
                    should actually act on. Dismissible.
        'verified'- nothing shown.
      */}
      {dataStatus === 'sample' && (
        <p
          role="status"
          className="border-t border-saffron/40 bg-saffron-soft px-4 py-1.5 text-center text-sm font-semibold text-saffron-ink"
        >
          ⚠️ {t.dataSample}
        </p>
      )}

      {dataStatus === 'partial' && !noticeDismissed && (
        <div className="flex items-center justify-center gap-3 border-t border-line bg-sunken px-4 py-1.5 text-center">
          <p role="status" className="text-sm text-muted">
            <span aria-hidden="true">🔗</span> {t.dataPartial}
          </p>
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            className="shrink-0 rounded-full border border-line px-3 py-0.5 text-xs font-semibold text-muted hover:bg-hover"
          >
            {t.dismiss}
          </button>
        </div>
      )}
    </header>
  )
}
