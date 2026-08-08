import { useLang } from '../context/LanguageContext'
import { QUICK_ACTIONS } from '../i18n/strings'

/**
 * The four doors into the app.
 *
 * A blank screen asks the user to invent a question. Four labelled cards ask
 * them to recognise one, and recognition is far easier than recall - especially
 * for someone who does not read fluently. Each card carries a large icon AND a
 * word, so it works whether or not the icon is understood.
 *
 * Two layouts:
 *   'hero'  - big two-column cards on the home screen
 *   'strip' - a compact scrolling row above the composer once a conversation has
 *             started, so the entry points never disappear entirely
 */
const ACCENT = {
  schemes: 'bg-leaf-soft text-leaf-ink border-leaf/30',
  weather: 'bg-saffron-soft text-saffron-ink border-saffron/30',
  health: 'bg-sunken text-ink border-line',
  rights: 'bg-sunken text-ink border-line',
}

export function QuickActionGrid({ onPick, disabled, variant = 'hero' }) {
  const { t, lang } = useLang()

  const pick = (action) =>
    onPick({
      utterance: action.utterance[lang] || action.utterance.hi,
      category: action.category,
    })

  if (variant === 'strip') {
    return (
      <div
        className="flex gap-2 overflow-x-auto px-4 pb-2"
        role="group"
        aria-label={t.quickTitle}
      >
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={disabled}
            onClick={() => pick(action)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-hover disabled:opacity-50"
          >
            <span aria-hidden="true">{action.icon}</span>
            {t[action.labelKey]}
          </button>
        ))}
      </div>
    )
  }

  return (
    <section aria-labelledby="quick-title" className="w-full">
      <h2 id="quick-title" className="sr-only">
        {t.quickTitle}
      </h2>

      <div className="grid grid-cols-2 gap-3">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={disabled}
            onClick={() => pick(action)}
            className={[
              'flex min-h-card flex-col items-center justify-center gap-2 rounded-card border-2 p-4 text-center',
              'shadow-card transition-transform duration-150 active:scale-[0.97] disabled:opacity-50',
              ACCENT[action.id] || ACCENT.health,
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-3xl leading-none">
              {action.icon}
            </span>
            <span className="text-base font-bold leading-snug">
              {t[action.labelKey]}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
