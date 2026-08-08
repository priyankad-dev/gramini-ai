import { useLang } from '../context/LanguageContext'
import { OK, CACHED } from '../hooks/useServiceHealth'

/**
 * A row of small per-service chips: what is live, what is degraded, what is out.
 *
 * Every chip carries an ICON, a COLOUR and a WORD. Colour alone would fail a
 * colour-blind judge and a phone screen in sunlight, and on stage the difference
 * between "the AI is out of quota" and "the app is broken" is the whole story.
 *
 * Only shown when something is not perfect - a full row of green chips is noise
 * that pushes the actual conversation down the screen.
 */
const TONE = {
  [OK]: 'bg-leaf-soft text-leaf-ink border-leaf/30',
  [CACHED]: 'bg-saffron-soft text-saffron-ink border-saffron/40',
  down: 'bg-sunken text-danger border-danger/40',
}

const DOT = { [OK]: '🟢', [CACHED]: '🟡', down: '🔴' }

export function ServiceChips({ health, always = false }) {
  const { t } = useLang()
  if (!health) return null

  const rows = [
    { key: 'internet', icon: '🌐', label: t.svcInternet, state: health.internet },
    { key: 'gemini', icon: '🤖', label: t.svcAi, state: health.gemini },
    { key: 'weather', icon: '🌦️', label: t.svcWeather, state: health.weather },
    { key: 'speechIn', icon: '🎤', label: t.svcMic, state: health.speechIn },
    { key: 'speechOut', icon: '🔊', label: t.svcVoice, state: health.speechOut },
    { key: 'camera', icon: '📷', label: t.svcCamera, state: health.camera },
  ]

  const degraded = rows.filter((r) => r.state !== OK)
  const shown = always ? rows : degraded
  if (!shown.length) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-1.5 border-b border-line bg-sunken px-3 py-1.5"
    >
      {shown.map((row) => (
        <span
          key={row.key}
          className={[
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold leading-none',
            TONE[row.state] || TONE.down,
          ].join(' ')}
        >
          <span aria-hidden="true">{DOT[row.state] || DOT.down}</span>
          <span aria-hidden="true">{row.icon}</span>
          {row.label}
        </span>
      ))}
    </div>
  )
}
