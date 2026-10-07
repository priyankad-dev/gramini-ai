import { useEffect, useRef } from 'react'
import { useLang } from '../context/LanguageContext'
import { SchemeCard } from './SchemeCard'
import { WeatherCard } from './WeatherCard'
import { Badge } from './ui/Badge'

/**
 * The conversation.
 *
 * The user's turn is a rounded saffron-tinted bubble on the right; the
 * assistant's turn is a card on the left with an avatar in the gutter.
 *
 * Two things here are load-bearing rather than decorative:
 *  - the user bubble shows what the app HEARD, so a mis-transcription is visible
 *    instead of silently producing a strange answer. Silent mis-hearing is the
 *    main way voice interfaces lose trust.
 *  - the assistant turn is a live region, so a screen-reader user gets the
 *    answer announced rather than having to hunt for it.
 */
function timeOf(message) {
  const at = message.at ? new Date(message.at) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Three dots while the answer is being fetched. */
export function TypingBubble({ label = null }) {
  const { t } = useLang()
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-saffron text-base text-onbrand"
      >
        🌾
      </span>
      <div className="rounded-card rounded-tl-sm border border-line bg-raised px-4 py-3 shadow-card">
        <span className={label ? 'mb-1.5 block text-sm text-muted' : 'sr-only'}>{label || t.thinking}</span>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-faint"
              style={{
                animation: 'orb-pulse 1s ease-in-out infinite',
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

export function ChatStream({ messages, onPickOther, onRepeat, thinking, thinkingLabel = null }) {
  const { t } = useLang()
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, thinking])

  return (
    <div className="flex flex-col gap-5 py-5">
      {messages.map((message) => {
        const stamp = timeOf(message)

        if (message.role === 'user') {
          return (
            <div key={message.id} className="animate-rise flex flex-col items-end gap-1">
              <p className="max-w-[85%] rounded-card rounded-br-sm bg-saffron-soft px-4 py-3 text-base font-medium text-saffron-ink">
                {message.text}
              </p>
              {stamp && <span className="px-1 text-xs text-faint">{stamp}</span>}
            </div>
          )
        }

        const schemeList = message.schemes?.length
          ? message.schemes
          : message.scheme
            ? [message.scheme]
            : []

        const badges = []
        if (schemeList.length) {
          badges.push(
            <Badge key="scheme" tone="leaf" icon="🏛️">
              {schemeList.length > 1
                ? `${t.cardSchemes} · ${schemeList.length}`
                : t.cardSchemes}
            </Badge>,
          )
        }
        if (message.weather) {
          badges.push(
            <Badge key="weather" tone="saffron" icon="🌦️">{t.cardWeather}</Badge>,
          )
        }
        if (message.offline) {
          badges.push(
            <Badge key="offline" tone="warn" icon="📴">{t.statusOffline}</Badge>,
          )
        } else if (message.serverDown) {
          badges.push(
            <Badge key="server" tone="warn" icon="⏳">{t.statusServer}</Badge>,
          )
        }

        return (
          <div key={message.id} className="animate-rise flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-saffron text-base text-onbrand"
            >
              🌾
            </span>

            <div className="min-w-0 flex-1">
              {badges.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">{badges}</div>
              )}

              {message.text && (
                <div className="rounded-card rounded-tl-sm border border-line bg-raised px-4 py-3 shadow-card">
                  <p
                    aria-live="polite"
                    className="whitespace-pre-wrap text-base leading-relaxed text-ink"
                  >
                    {message.text}
                  </p>
                </div>
              )}

              {/* Task 6: the capture is shown whether or not the model could
                  read it - a failed analysis must not look like a failed camera. */}
              {message.image && (
                <img
                  src={message.image}
                  alt=""
                  className="mt-3 max-h-56 w-auto rounded-card border border-line object-contain"
                />
              )}

              {message.weather && (
                <div className="mt-3">
                  <WeatherCard
                    weather={message.weather}
                    cached={message.cached}
                    cacheAgeSeconds={message.cacheAgeSeconds}
                  />
                </div>
              )}

              {/* Every matching scheme gets its own full card, numbered when
                  there is more than one. Cards rather than a list, because the
                  helpline and the official link have to be tappable on each. */}
              {schemeList.map((scheme, index) => (
                <div key={scheme.id || index} className="mt-3">
                  {schemeList.length > 1 && (
                    <p className="mb-1 px-1 text-sm font-bold text-muted">
                      {index + 1}. {scheme.name}
                    </p>
                  )}
                  <SchemeCard
                    scheme={scheme}
                    others={[]}
                    onPickOther={onPickOther}
                    onRepeat={() => onRepeat(message)}
                  />
                </div>
              ))}

              <div className="mt-2 flex items-center gap-2">
                {message.text && (
                  <button
                    type="button"
                    onClick={() => onRepeat(message)}
                    className="rounded-full border border-line px-3 py-1 text-sm font-semibold text-muted transition-colors hover:bg-hover"
                  >
                    🔁 {t.repeat}
                  </button>
                )}
                {stamp && <span className="text-xs text-faint">{stamp}</span>}
              </div>
            </div>
          </div>
        )
      })}

      {thinking && <TypingBubble label={thinkingLabel} />}
      <div ref={endRef} />
    </div>
  )
}
