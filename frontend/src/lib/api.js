import {
  localTurn,
  cacheSchemes,
  getCachedSchemes,
  rememberLangConfirm,
} from './offline'

// Task 10: nothing may hang the interface for more than ten seconds. After
// that the request is aborted and the caller falls back to local data, which
// is always available. A spinner that never resolves is the worst thing a
// judge can be shown, because it looks identical to a crash.
import { apiUrl } from './config'

const TIMEOUT_MS = 10000

function announceReachability(reachable) {
  window.dispatchEvent(
    new CustomEvent('gramini:reachability', { detail: { reachable } }),
  )
}

// Translating a whole interface into a new language is a model call over ~30
// strings, so it gets far longer than an ordinary turn. It happens once per
// language, and only the first time that language is ever used.
const TRANSLATE_TIMEOUT_MS = 90000

async function post(path, body, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    announceReachability(true)
    return data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One spoken turn.
 *
 * If the backend cannot be reached we do NOT show an error. We answer from the
 * scheme pack cached on the device. PS07 asks for the app to work on poor
 * connectivity, so being offline is a normal state here, not a failure state.
 */
export async function sendTurn(text, lang) {
  try {
    const data = await post('/api/turn', { text, lang })
    // Keep the confirmation sentence so the same switch works offline later.
    if (data?.action === 'CHANGE_UI_LANGUAGE' && data.speech) {
      rememberLangConfirm(data.lang, data.speech)
    }
    return data
  } catch {
    announceReachability(false)
    return { ...localTurn(text, lang), offline: true }
  }
}

export async function lookupScheme({ query, schemeId, category, lang }) {
  try {
    return await post('/api/scheme', {
      query: query ?? null,
      scheme_id: schemeId ?? null,
      category: category ?? null,
      lang,
    })
  } catch {
    announceReachability(false)
    return { ...localTurn(query || category || '', lang), offline: true }
  }
}

export async function readImage(dataUrl, lang) {
  try {
    return await post('/api/vision', { image: dataUrl, lang })
  } catch {
    announceReachability(false)
    const message = {
      hi: 'तस्वीर पढ़ने के लिए इंटरनेट चाहिए। अभी इंटरनेट नहीं है।',
      en: 'Reading a photo needs internet. There is no internet right now.',
      mr: 'फोटो वाचण्यासाठी इंटरनेट लागते. सध्या इंटरनेट नाही.',
    }
    return { ok: false, speech: message[lang] || message.hi, offline: true }
  }
}

/** Every language the server speaks. Cached by the caller for offline opens. */
export async function fetchLanguages() {
  const response = await fetch(apiUrl('/api/languages'))
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  announceReachability(true)
  return data
}

/**
 * The interface itself, in a language we did not hand-write.
 *
 * `source` is the English string table. The server translates and caches it, so
 * this is paid once per language for the whole event, not once per user.
 */
export async function fetchUiStrings(lang, source) {
  return post('/api/ui-strings', { lang, strings: source }, TRANSLATE_TIMEOUT_MS)
}

/**
 * Pull the whole scheme pack once and keep it on the device.
 *
 * This is what makes the offline demo real: after one successful load, all
 * eight schemes answer with zero network.
 */
export async function syncSchemes(lang) {
  try {
    const response = await fetch(apiUrl(`/api/schemes?lang=${encodeURIComponent(lang)}`))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    cacheSchemes(lang, data)
    announceReachability(true)
    return data
  } catch {
    announceReachability(false)
    return getCachedSchemes(lang)
  }
}
