import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { DEFAULT_LANG, LANGS, strings } from '../i18n/strings'
import { fetchLanguages, fetchUiStrings } from '../lib/api'

const LanguageContext = createContext(null)

const STORAGE_KEY = 'gramini.lang'
const REGISTRY_KEY = 'gramini.languages'
const uiKey = (code) => `gramini.ui.${code}`

/** Tier-1 languages ship in the bundle and never need the network. */
const isVerified = (code) => Object.hasOwn(strings, code)

function readCache(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked. Not a reason to fail.
  }
}

/** Registry: the three built-in languages, plus whatever the server knows. */
function initialRegistry() {
  const cached = readCache(REGISTRY_KEY)
  return cached && typeof cached === 'object' ? { ...LANGS, ...cached } : { ...LANGS }
}

function detectInitialLang(registry) {
  // 1. What the user chose last time.
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && registry[saved]) return saved
  } catch {
    // localStorage can be blocked; not a reason to fail.
  }

  // 2. What the phone itself is set to. A phone set to Marathi is a strong
  //    signal, and asking a low-literacy user to pick a language on first open
  //    is exactly the friction we are trying to remove.
  const nav = (navigator.language || '').toLowerCase()
  const base = nav.split('-')[0]
  for (const code of Object.keys(registry)) {
    if (base === code) return code
  }

  // 3. Hindi, not English. The default should suit the user, not the developer.
  return DEFAULT_LANG
}

export function LanguageProvider({ children }) {
  const [registry, setRegistry] = useState(initialRegistry)
  const [lang, setLangState] = useState(() => detectInitialLang(initialRegistry()))

  // UI strings for tier-2 languages, fetched once then kept in localStorage.
  const [remoteStrings, setRemoteStrings] = useState(() => {
    const start = {}
    for (const code of Object.keys(initialRegistry())) {
      if (isVerified(code)) continue
      const cached = readCache(uiKey(code))
      if (cached) start[code] = cached
    }
    return start
  })
  const [translating, setTranslating] = useState(false)

  // Learn every language the server supports. Falls back to the built-in three
  // if the server is unreachable, so the app still opens with no network.
  useEffect(() => {
    let cancelled = false
    fetchLanguages()
      .then((data) => {
        if (cancelled || !data?.languages?.length) return
        const next = { ...LANGS }
        for (const item of data.languages) {
          next[item.code] = {
            code: item.code,
            bcp47: item.bcp47,
            label: item.endonym,
            english: item.english,
            short: item.endonym.slice(0, 3),
            verified: isVerified(item.code),
          }
        }
        setRegistry(next)
        writeCache(REGISTRY_KEY, next)
      })
      .catch(() => {
        // Offline on first open. The built-in three still work.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setLang = useCallback(
    (next) => {
      if (!next) return
      // Accept a language the registry has not loaded yet: the backend already
      // decided this code is real, and refusing it would drop a switch the user
      // just asked for out loud.
      setLangState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
    },
    [],
  )

  // Fetch the interface in a tier-2 language the first time it is used.
  useEffect(() => {
    if (isVerified(lang) || remoteStrings[lang]) return
    let cancelled = false
    setTranslating(true)
    fetchUiStrings(lang, strings.en)
      .then((data) => {
        if (cancelled || !data?.strings) return
        setRemoteStrings((prev) => ({ ...prev, [lang]: data.strings }))
        if (data.translated) writeCache(uiKey(lang), data.strings)
      })
      .catch(() => {
        // Stays in the fallback language, which is honest and readable.
      })
      .finally(() => {
        if (!cancelled) setTranslating(false)
      })
    return () => {
      cancelled = true
    }
  }, [lang, remoteStrings])

  // Keep the document in step, so screen readers announce the right language.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => {
    const entry = registry[lang] || LANGS[DEFAULT_LANG]
    const verified = isVerified(lang)
    return {
      lang,
      setLang,
      // Tier-2 falls back to Hindi until its translation arrives. Hindi is the
      // language the scheme text was verified in, so the fallback is never a
      // guess - it is the checked original.
      t: verified ? strings[lang] : { ...strings[DEFAULT_LANG], ...(remoteStrings[lang] || {}) },
      bcp47: entry?.bcp47 || 'hi-IN',
      langLabel: entry?.label || lang,
      langEnglish: entry?.english || lang,
      isVerifiedLang: verified,
      translating,
      allLangs: registry,
    }
  }, [lang, setLang, registry, remoteStrings, translating])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLang() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang must be used inside <LanguageProvider>')
  return ctx
}
