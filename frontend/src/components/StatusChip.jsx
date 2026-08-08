import { useLang } from '../context/LanguageContext'

/**
 * One chip at the top that always answers "is this thing working right now?"
 *
 * PS07 is about poor connectivity, so the app's honest state is part of the
 * product rather than an error case. Three states, each with a colour AND a
 * word AND a shape, so none of them depends on colour vision alone:
 *
 *   green   online, live answers
 *   amber   online but serving something cached, or the AI is unavailable
 *   red     no network at all - saved schemes still answer
 *
 * Deliberately never hidden. A user who cannot tell whether the app is stuck or
 * simply offline will tap the same button over and over.
 */
const TONES = {
  ok: 'bg-leaf-soft text-leaf-ink border-leaf/40',
  warn: 'bg-saffron-soft text-saffron-ink border-saffron/50',
  danger: 'bg-sunken text-danger border-danger/50',
}

const DOT = {
  ok: 'bg-leaf',
  warn: 'bg-saffron',
  danger: 'bg-danger',
}

export function StatusChip({ online, aiReady, usingCache }) {
  const { t } = useLang()

  let tone = 'ok'
  let label = t.statusOnline
  if (!online) {
    tone = 'danger'
    label = t.statusOffline
  } else if (usingCache) {
    tone = 'warn'
    label = t.statusCached
  } else if (aiReady === false) {
    tone = 'warn'
    label = t.statusAiDown
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
        TONES[tone],
      ].join(' ')}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  )
}
