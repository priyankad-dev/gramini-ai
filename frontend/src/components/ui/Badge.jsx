/**
 * One small labelled pill, used for every badge in the app.
 *
 * Each tone pairs a fill with text that clears WCAG AA against it, and every
 * badge carries a WORD, not just a colour - a colour-blind user, or anyone
 * glancing at a phone in sunlight, must still be able to tell "Live" from
 * "Cached".
 */
const TONES = {
  neutral: 'bg-sunken text-muted border-line',
  saffron: 'bg-saffron-soft text-saffron-ink border-saffron/30',
  leaf: 'bg-leaf-soft text-leaf-ink border-leaf/30',
  ok: 'bg-leaf-soft text-leaf-ink border-leaf/30',
  warn: 'bg-saffron-soft text-saffron-ink border-saffron/40',
  danger: 'bg-sunken text-danger border-danger/40',
}

export function Badge({ tone = 'neutral', icon, children, className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
        TONES[tone] || TONES.neutral,
        className,
      ].join(' ')}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  )
}
