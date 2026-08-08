import { useLang } from '../context/LanguageContext'
import { Waveform } from './ui/VoiceOrb'

/**
 * The composer, for once a conversation has started.
 *
 * The middle is a DISPLAY, not a text input: there is no keyboard anywhere on
 * the voice path, so the area a chat app would give to a textarea shows the live
 * transcript instead. A mis-heard word becomes visible immediately rather than
 * silently producing a strange answer.
 *
 * State is carried by colour, motion AND a word at once, so it survives a screen
 * reader, prefers-reduced-motion, and a cracked screen in bright sunlight.
 */
const LABEL_KEY = {
  idle: 'composerHint',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
}

export function VoiceController({
  state,
  interim,
  supported,
  onStart,
  onStop,
  onCamera,
}) {
  const { t } = useLang()
  const busy = state === 'listening' || state === 'speaking'
  const listening = state === 'listening'
  const speaking = state === 'speaking'

  if (!supported) {
    return (
      <div
        role="alert"
        className="rounded-card border-2 border-danger bg-surface px-4 py-3 text-center text-base font-semibold text-danger"
      >
        🎤 {t.micUnsupported}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2 rounded-composer border border-line bg-surface p-2 pl-3 shadow-card">
        <button
          type="button"
          onClick={onCamera}
          aria-label={t.cameraOpen}
          title={t.cameraOpen}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <span aria-hidden="true" className="text-xl">📷</span>
        </button>

        {/* Where a chat app puts its textarea. We show speech instead. */}
        <div className="min-h-[3rem] flex-1 self-center py-2">
          <p
            aria-live="polite"
            className={[
              'text-base',
              interim ? 'font-medium text-ink' : 'text-faint',
            ].join(' ')}
          >
            {interim || t[LABEL_KEY[state]]}
          </p>
          {(listening || speaking) && (
            <Waveform
              barClass={listening ? 'bg-saffron' : 'bg-leaf'}
              className="mt-1.5 h-3"
            />
          )}
        </div>

        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
          {busy && (
            <span
              aria-hidden="true"
              className={[
                'absolute inset-0 rounded-full',
                listening ? 'bg-saffron' : 'bg-leaf',
              ].join(' ')}
              style={{ animation: 'orb-ring 2s ease-out infinite' }}
            />
          )}
          <button
            type="button"
            onClick={busy ? onStop : onStart}
            aria-label={busy ? t.tapToStop : t.tapToSpeak}
            className={[
              'relative z-10 flex h-12 w-12 items-center justify-center rounded-full text-onbrand transition-transform active:scale-95',
              listening ? 'bg-saffron' : speaking ? 'bg-leaf' : 'bg-saffron',
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-xl">
              {speaking ? '⏹' : state === 'thinking' ? '⏳' : '🎤'}
            </span>
          </button>
        </div>
      </div>

      <p className="px-2 text-center text-xs text-faint">{t.disclaimer}</p>
    </div>
  )
}
