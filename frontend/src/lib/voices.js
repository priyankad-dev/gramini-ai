/**
 * Picking the right voice to speak with.
 *
 * This is harder than it looks, and getting it wrong is invisible: the browser
 * happily speaks Gujarati text with an American English voice and reports no
 * error at all. Four things have to be true at once.
 *
 * 1. The voice list must be LOADED. `speechSynthesis.getVoices()` returns an
 *    empty array on the first call in Chrome and fills in asynchronously, so
 *    anything that reads it synchronously on page load sees nothing and falls
 *    back to the default English voice.
 *
 * 2. The match must be tolerant. Platforms disagree on the tag format - Chrome
 *    reports `ta-IN`, some Android builds report `ta_IN`, and a few voices carry
 *    just `ta`. A `===` comparison misses all but one of those.
 *
 * 3. There must be a real fallback chain. Leaving `utterance.voice` unset does
 *    NOT make the browser honour `utterance.lang`; it uses the system default,
 *    which is almost always English.
 *
 * 4. The choice must be made fresh for every utterance, never cached, because
 *    the whole point of this app is that the language changes mid-conversation.
 */

/** Everything we need to recognise a language in a voice list. */
const LANGUAGES = {
  hi: { bcp47: 'hi-IN', english: 'Hindi', native: 'हिन्दी' },
  en: { bcp47: 'en-IN', english: 'English', native: 'English' },
  mr: { bcp47: 'mr-IN', english: 'Marathi', native: 'मराठी' },
  bn: { bcp47: 'bn-IN', english: 'Bengali', native: 'বাংলা' },
  te: { bcp47: 'te-IN', english: 'Telugu', native: 'తెలుగు' },
  ta: { bcp47: 'ta-IN', english: 'Tamil', native: 'தமிழ்' },
  gu: { bcp47: 'gu-IN', english: 'Gujarati', native: 'ગુજરાતી' },
  kn: { bcp47: 'kn-IN', english: 'Kannada', native: 'ಕನ್ನಡ' },
  ml: { bcp47: 'ml-IN', english: 'Malayalam', native: 'മലയാളം' },
  pa: { bcp47: 'pa-IN', english: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  or: { bcp47: 'or-IN', english: 'Odia', native: 'ଓଡ଼ିଆ' },
  as: { bcp47: 'as-IN', english: 'Assamese', native: 'অসমীয়া' },
  ur: { bcp47: 'ur-IN', english: 'Urdu', native: 'اردو' },
  ne: { bcp47: 'ne-NP', english: 'Nepali', native: 'नेपाली' },
  sa: { bcp47: 'sa-IN', english: 'Sanskrit', native: 'संस्कृतम्' },
  kok: { bcp47: 'kok-IN', english: 'Konkani', native: 'कोंकणी' },
  mai: { bcp47: 'mai-IN', english: 'Maithili', native: 'मैथिली' },
  bho: { bcp47: 'bho-IN', english: 'Bhojpuri', native: 'भोजपुरी' },
  sd: { bcp47: 'sd-IN', english: 'Sindhi', native: 'سنڌي' },
  ks: { bcp47: 'ks-IN', english: 'Kashmiri', native: 'کٲشُر' },
  doi: { bcp47: 'doi-IN', english: 'Dogri', native: 'डोगरी' },
  mni: { bcp47: 'mni-IN', english: 'Manipuri', native: 'Manipuri' },
  sat: { bcp47: 'sat-IN', english: 'Santali', native: 'Santali' },
  brx: { bcp47: 'brx-IN', english: 'Bodo', native: 'Bodo' },
}

/**
 * Which writing system a piece of text is in, and which one a voice can read.
 *
 * This is the difference between "the voice is wrong" and "the voice is silent".
 * A text-to-speech engine only pronounces the script it was trained on: an
 * en-US voice handed
 *
 *     "पीएम-किसान... हर साल 6,000 रुपये... CSC केंद्र... pmkisan.gov.in"
 *
 * skips every Devanagari character and reads out
 *
 *     "- : 6,000 : CSC , pmkisan.gov.in"
 *
 * which is 16% of the answer and sounds like the app is broken. That is the
 * "reads only letters and numbers" symptom exactly.
 *
 * So a voice is only usable if its script matches the text's.
 */
const SCRIPT_RANGES = {
  latin: [[0x0041, 0x005a], [0x0061, 0x007a]],
  deva: [[0x0900, 0x097f]],
  beng: [[0x0980, 0x09ff]],
  guru: [[0x0a00, 0x0a7f]],
  gujr: [[0x0a80, 0x0aff]],
  orya: [[0x0b00, 0x0b7f]],
  taml: [[0x0b80, 0x0bff]],
  telu: [[0x0c00, 0x0c7f]],
  knda: [[0x0c80, 0x0cff]],
  mlym: [[0x0d00, 0x0d7f]],
  arab: [[0x0600, 0x06ff], [0x0750, 0x077f]],
}

const LANG_SCRIPT = {
  en: 'latin',
  hi: 'deva', mr: 'deva', ne: 'deva', sa: 'deva', kok: 'deva',
  mai: 'deva', doi: 'deva', brx: 'deva', bho: 'deva',
  bn: 'beng', as: 'beng',
  pa: 'guru', gu: 'gujr', or: 'orya',
  ta: 'taml', te: 'telu', kn: 'knda', ml: 'mlym',
  ur: 'arab', sd: 'arab', ks: 'arab',
}

/** The script most of this text is written in, ignoring digits and spaces. */
export function scriptOfText(text) {
  const counts = {}
  let letters = 0
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0)
    for (const [script, ranges] of Object.entries(SCRIPT_RANGES)) {
      if (ranges.some(([lo, hi]) => code >= lo && code <= hi)) {
        counts[script] = (counts[script] || 0) + 1
        letters += 1
        break
      }
    }
  }
  if (!letters) return null
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return best[0]
}

/** Can this voice actually pronounce this text, or only the stray Latin bits? */
export function voiceCanRead(voice, text) {
  if (!voice) return false
  const textScript = scriptOfText(text)
  if (!textScript) return true // digits/punctuation only - anything can say it
  const voiceScript = LANG_SCRIPT[baseOf(voice.lang)]
  if (!voiceScript) return true // unknown voice language: give it the benefit
  return voiceScript === textScript
}

/** `ta_IN`, `ta-in`, ` ta-IN ` all become `ta-in`. */
const normaliseTag = (tag) => String(tag || '').trim().replace(/_/g, '-').toLowerCase()

/** The part before the region: `ta-IN` -> `ta`. */
const baseOf = (tag) => normaliseTag(tag).split('-')[0]

export function bcp47For(code) {
  return LANGUAGES[code]?.bcp47 || `${code}-IN`
}

// -------------------------------------------------------------- voice loading

let cachedVoices = []
let voicesReady = false

/**
 * Resolve once the browser has actually populated its voice list.
 *
 * Chrome fires `voiceschanged` a beat after load, and again when remote (Google)
 * voices arrive over the network - which is where every Indian-language voice
 * comes from on a desktop that has none installed locally. Waiting for that
 * event is the difference between "no Marathi voice exists" and "no Marathi
 * voice existed 200ms ago".
 */
export function loadVoices(timeoutMs = 2500) {
  const synth = window.speechSynthesis
  if (!synth) return Promise.resolve([])

  const current = synth.getVoices() || []
  if (current.length) {
    cachedVoices = current
    voicesReady = true
    return Promise.resolve(current)
  }

  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      synth.removeEventListener?.('voiceschanged', done)
      clearTimeout(timer)
      cachedVoices = synth.getVoices() || []
      voicesReady = true
      resolve(cachedVoices)
    }
    const timer = setTimeout(done, timeoutMs)
    synth.addEventListener?.('voiceschanged', done)
  })
}

/** Keep the cache warm as the browser adds voices (e.g. remote ones arriving). */
export function watchVoices(onChange) {
  const synth = window.speechSynthesis
  if (!synth) return () => {}
  const refresh = () => {
    cachedVoices = synth.getVoices() || []
    voicesReady = cachedVoices.length > 0
    onChange?.(cachedVoices)
  }
  refresh()
  synth.addEventListener?.('voiceschanged', refresh)
  return () => synth.removeEventListener?.('voiceschanged', refresh)
}

export function currentVoices() {
  const synth = window.speechSynthesis
  const live = synth?.getVoices?.() || []
  if (live.length) cachedVoices = live
  return cachedVoices
}

// ------------------------------------------------------------- voice matching

/**
 * Choose the best voice for a language, with a documented fallback chain.
 *
 * Returns { voice, reason, exact }. `voice` may be null, which means "let the
 * browser decide" - the caller should still set `utterance.lang`, and should
 * tell the user that the answer may not sound right.
 *
 * The chain, in order:
 *   1. exact tag             ta-IN  -> ta-IN
 *   2. same language         ta-IN  -> ta, ta-LK
 *   3. voice NAME mentions it        "Google தமிழ்", "Microsoft Valluvar - Tamil"
 *   4. another Indian voice  ta-IN  -> hi-IN         (closer phonemes than en-US)
 *   5. English (India)       en-IN
 *   6. nothing               browser default
 */
export function pickVoice(bcp47, voices = currentVoices(), { offline = false } = {}) {
  const wanted = normaliseTag(bcp47)
  const base = baseOf(bcp47)
  const meta = LANGUAGES[base]

  if (!voices.length) {
    return { voice: null, reason: 'no-voices-loaded', exact: false }
  }

  /*
    Offline, only LOCAL voices can actually speak.

    This is the whole reason voice died without a network. Every Indian-language
    voice Chrome offers on a stock machine is one of Google's REMOTE voices
    (`localService: false`) - synthesised on their servers and streamed back. The
    browser still LISTS them offline, and `speak()` still resolves, but no sound
    comes out and no error is raised.

    So with no network the candidate list is narrowed to voices that live on the
    device. If that leaves nothing usable the caller drops to recorded audio, and
    then to text.
  */
  if (offline) {
    const local = voices.filter((v) => v.localService)
    if (!local.length) {
      return { voice: null, reason: 'offline-no-local-voice', exact: false }
    }
    voices = local
  }

  // 1. Exact tag.
  const exact = voices.find((v) => normaliseTag(v.lang) === wanted)
  if (exact) return { voice: exact, reason: 'exact', exact: true }

  // 2. Same language, any region.
  const sameLang = voices.find((v) => baseOf(v.lang) === base)
  if (sameLang) return { voice: sameLang, reason: 'same-language', exact: true }

  // 3. The name gives it away even when the tag does not.
  if (meta) {
    const needles = [meta.english.toLowerCase(), meta.native.toLowerCase()]
    const byName = voices.find((v) => {
      const name = String(v.name || '').toLowerCase()
      return needles.some((n) => n && name.includes(n))
    })
    if (byName) return { voice: byName, reason: 'name-match', exact: true }
  }

  /*
    4. Another voice for the SAME SCRIPT.

       A Marathi voice can read Hindi and vice versa - both are Devanagari, so
       the words come out, accent aside. That is a genuinely useful fallback.
  */
  const wantedScript = LANG_SCRIPT[base]
  if (wantedScript) {
    const sameScript = voices.find(
      (v) => LANG_SCRIPT[baseOf(v.lang)] === wantedScript,
    )
    if (sameScript) {
      return { voice: sameScript, reason: 'same-script', exact: false }
    }
  }

  /*
    5. Nothing left can read this script.

       Returning an English voice here is worse than returning nothing: it
       pronounces only the digits and Latin acronyms and skips the rest, which
       is the "reads only letters and numbers" bug. The caller is expected to
       fall through to recorded audio, and then to text on screen.

       The one exception is text that has no letters of its own - a bare number
       or a URL - which any voice can say.
  */
  if (wantedScript && wantedScript !== 'latin') {
    return { voice: null, reason: 'no-voice-for-script', exact: false }
  }

  // 6. Latin text: any English voice will do.
  const enIn = voices.find((v) => normaliseTag(v.lang) === 'en-in')
  if (enIn) return { voice: enIn, reason: 'english-india', exact: false }
  const anyEnglish = voices.find((v) => baseOf(v.lang) === 'en')
  if (anyEnglish) return { voice: anyEnglish, reason: 'english-any', exact: false }

  return { voice: voices[0] || null, reason: 'browser-default', exact: false }
}

/** Is there a genuinely correct voice for this language on this device? */
export function hasNativeVoice(bcp47, voices = currentVoices()) {
  if (!voices.length) return null // unknown, not "no"
  return pickVoice(bcp47, voices).exact
}

/** Can this device speak this language with NO network? */
export function hasOfflineVoice(bcp47, voices = currentVoices()) {
  if (!voices.length) return null
  return Boolean(pickVoice(bcp47, voices, { offline: true }).voice)
}

const warned = new Set()

/**
 * One console line per utterance, and a one-time warning per language.
 *
 * A missing voice is silent by design in the Web Speech API, so without this
 * the only symptom is "it speaks English" with nothing to point at.
 */
export function logVoiceChoice(bcp47, picked, voices) {
  const base = baseOf(bcp47)
  const name = LANGUAGES[base]?.english || base

  if (!picked.exact && !warned.has(base)) {
    warned.add(base)
    console.warn(
      `[Gramini TTS] No native ${name} voice installed. ` +
        `Falling back to "${picked.voice?.name || 'browser default'}" ` +
        `(${picked.voice?.lang || 'unknown'}) - reason: ${picked.reason}.\n` +
        `Install the ${name} language pack, or use Chrome online so Google's ` +
        `remote voices are available.`,
    )
  }

  console.info(
    `[Gramini TTS] lang=${bcp47} -> voice="${picked.voice?.name || 'default'}" ` +
      `(${picked.voice?.lang || '-'}) match=${picked.reason} ` +
      `voicesLoaded=${voices.length}`,
  )
}

/** For the debug panel / console: what does this device actually have? */
export function describeVoices(voices = currentVoices()) {
  return voices.map((v) => `${v.lang}  ${v.name}${v.localService ? '' : '  (remote)'}`)
}

export { LANGUAGES, normaliseTag, baseOf, voicesReady }
