import { useLang } from '../context/LanguageContext'

/**
 * PS07 asks the app to work on poor connectivity. We cannot run a language model
 * on the device in one day, so instead of pretending, we degrade in the open:
 * say plainly that the network is gone, and keep answering from the scheme pack
 * saved on the phone.
 */
export function OfflineBanner({ connection = 'online' }) {
  const { t } = useLang()
  if (connection === 'online') return null

  // Only a phone with no connection hears about its internet. A sleeping or
  // failing server is our problem, and the words say so.
  const text = {
    offline: `📴 ${t.offlineModeOn}`,
    waking: `⏳ ${t.serverWaking}`,
    'server-down': `⚠️ ${t.serverDown}`,
  }[connection]

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-saffron/40 bg-saffron/10 px-4 py-2 text-center text-sm font-medium text-saffron"
    >
      {text}
    </div>
  )
}
