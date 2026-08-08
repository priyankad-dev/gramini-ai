import { useLang } from '../context/LanguageContext'

/**
 * Two admissions the app makes out loud, for the same reason the offline banner
 * exists: degrading in the open beats degrading silently.
 *
 *  1. This language was machine-translated. The user is told, every time, that
 *     the checked wording lives in Hindi - because the thing being translated
 *     decides whether they get money.
 *  2. This device has no voice for this language. A voice-first app that cannot
 *     speak looks broken rather than limited, and the person most affected is
 *     the one who cannot read the answer instead.
 */
export function LanguageNotices({ voiceAvailable, voiceBlocked }) {
  const { t, isVerifiedLang, translating } = useLang()

  const notices = []
  if (translating) {
    notices.push({ key: 'translating', icon: '⏳', text: t.translatingNow })
  } else if (!isVerifiedLang) {
    notices.push({ key: 'machine', icon: '🔤', text: t.machineTranslated })
  }
  if (voiceBlocked) {
    // Nothing at all can speak: no offline voice, no recording. Say so
    // explicitly rather than leaving the user staring at a silent screen -
    // silence is indistinguishable from a crash in a voice-first app.
    notices.push({ key: 'blocked', icon: '🔇', text: t.voiceOfflineUnavailable })
  } else if (voiceAvailable === false) {
    notices.push({ key: 'voice', icon: '🔇', text: t.noVoice })
  }

  if (!notices.length) return null

  return (
    <>
      {notices.map((notice) => (
        <div
          key={notice.key}
          role="status"
          aria-live="polite"
          className="border-b border-line bg-sunken px-4 py-2 text-center text-sm font-medium text-muted"
        >
          <span aria-hidden="true">{notice.icon}</span> {notice.text}
        </div>
      ))}
    </>
  )
}
