import { useLang } from '../../context/LanguageContext'

/**
 * The one thing on the home screen you cannot miss.
 *
 * A 128px saffron circle, because the single hardest moment for a first-time
 * smartphone user is working out where to start. There is exactly one target,
 * it is in the middle of the screen, and it is the brightest thing on it.
 *
 * State is carried three ways at once - colour, motion and a word underneath -
 * so it survives a screen reader, prefers-reduced-motion, and a cracked screen
 * in bright sun. Motion alone would fail all three.
 */
const VISUALS = {
  idle: { fill: 'bg-saffron', icon: '🎤', ring: false, bars: false },
  listening: { fill: 'bg-saffron', icon: '🎤', ring: true, bars: true },
  thinking: { fill: 'bg-saffron-strong', icon: '⏳', ring: false, bars: false },
  speaking: { fill: 'bg-leaf', icon: '🔊', ring: true, bars: true },
}

const LABEL_KEY = {
  idle: 'tapToSpeak',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
}

/** Five bars that rise and fall while the mic is open or the app is talking.
 *
 * `barClass` is passed in whole rather than interpolated - Tailwind scans source
 * text, so a class built at runtime (`bg-${tone}`) is never emitted and the bars
 * come out invisible.
 */
function Waveform({ barClass = 'bg-onbrand', className = 'h-5' }) {
  return (
    <span aria-hidden="true" className={`flex items-end gap-[3px] ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full ${barClass}`}
          style={{
            height: '100%',
            animation: 'bar 0.9s ease-in-out infinite',
            animationDelay: `${i * 0.11}s`,
            transformOrigin: 'center bottom',
          }}
        />
      ))}
    </span>
  )
}

export function VoiceOrb({ state = 'idle', interim, onStart, onStop, size = 128 }) {
  const { t } = useLang()
  const visual = VISUALS[state] || VISUALS.idle
  const busy = state === 'listening' || state === 'speaking'

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {visual.ring && (
          <>
            <span
              aria-hidden="true"
              className={`absolute inset-0 rounded-full ${visual.fill} opacity-40`}
              style={{ animation: 'orb-ring 2s ease-out infinite' }}
            />
            <span
              aria-hidden="true"
              className={`absolute inset-0 rounded-full ${visual.fill} opacity-30`}
              style={{ animation: 'orb-ring 2s ease-out 1s infinite' }}
            />
          </>
        )}

        <button
          type="button"
          onClick={busy ? onStop : onStart}
          aria-label={busy ? t.tapToStop : t.tapToSpeak}
          className={[
            'relative z-10 flex items-center justify-center rounded-full text-onbrand shadow-orb',
            'transition-transform duration-200 active:scale-95',
            visual.fill,
          ].join(' ')}
          style={{
            width: size,
            height: size,
            animation:
              state === 'idle' ? 'orb-pulse 2.4s ease-in-out infinite' : undefined,
          }}
        >
          {visual.bars ? (
            <Waveform />
          ) : (
            <span aria-hidden="true" style={{ fontSize: size * 0.34 }}>
              {visual.icon}
            </span>
          )}
        </button>
      </div>

      {/* The word matters as much as the animation. */}
      <p aria-live="polite" className="min-h-[1.75rem] text-center text-lg font-semibold text-ink">
        {interim || t[LABEL_KEY[state]]}
      </p>
    </div>
  )
}

export { Waveform }
