import { useLang } from '../context/LanguageContext'

/**
 * The single tap the browser demands, turned into the friendliest thing on the
 * screen.
 *
 * Chrome will not let a page speak or open a microphone until it has had a real
 * user gesture. That is not negotiable and not a design choice, so rather than
 * hide it behind a tiny "allow" prompt this screen makes it the one obvious
 * thing to do: a target that fills the middle of the screen and cannot be
 * missed by someone who does not read.
 *
 * After this, the user never presses anything again.
 */
export function StartScreen({ onStart }) {
  const { t } = useLang()

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-surface px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden="true"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-saffron-soft text-4xl"
        >
          🌾
        </span>
        <h1 className="text-2xl font-semibold text-ink">{t.appName}</h1>
      </div>

      <button
        type="button"
        onClick={onStart}
        autoFocus
        className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full bg-saffron text-onbrand shadow-orb transition-transform active:scale-95"
      >
        <span aria-hidden="true" className="text-5xl">🎙️</span>
        <span className="px-3 text-center text-base font-semibold leading-tight">
          {t.startButton}
        </span>
      </button>

      <p className="max-w-sm text-center text-base text-muted">
        {t.startHint}
      </p>
    </div>
  )
}
