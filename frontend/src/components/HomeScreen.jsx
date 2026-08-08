import { useLang } from '../context/LanguageContext'
import { VoiceOrb } from './ui/VoiceOrb'
import { QuickActionGrid } from './QuickActionGrid'

/**
 * Voice first, chat second.
 *
 * A chat-first screen opens on an empty thread and a text box, which asks the
 * user to invent a question and type it. Both of those are exactly what our
 * users cannot do. So the first screen is one enormous microphone with a
 * greeting under it, and the four quick actions sit below as the recognition
 * path for anyone who would rather point than talk.
 *
 * Recognition beats recall, especially for someone who does not read fluently.
 */
export function HomeScreen({
  voiceState,
  interim,
  onStart,
  onStop,
  onPick,
  disabled,
}) {
  const { t } = useLang()

  return (
    <div className="flex min-h-full flex-col items-center justify-between gap-6 px-4 py-6">
      {/* Greeting above the orb: says who is speaking before it speaks. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-extrabold text-ink">{t.spokenGreetingShort}</h1>
        <p className="text-base text-muted">{t.greeting}</p>
      </div>

      <VoiceOrb
        state={voiceState}
        interim={interim}
        onStart={onStart}
        onStop={onStop}
        size={128}
      />

      <div className="w-full max-w-thread">
        <p className="mb-3 text-center text-sm text-faint">{t.homeHelp}</p>
        <QuickActionGrid onPick={onPick} disabled={disabled} variant="hero" />
      </div>
    </div>
  )
}
