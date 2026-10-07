/**
 * The offline half of the app.
 *
 * A small mirror of the backend's scheme matcher, running on the device. It is
 * deliberately the same shape as backend/schemes.py so an answer looks identical
 * whether it came over the network or out of localStorage - the user should not
 * be able to tell, apart from the offline banner.
 *
 * What it can do offline:  scheme lookup, the language switch, repeat.
 * What it cannot do:       free chat and camera reading. Those say so honestly.
 */

const KEY = (lang) => `gramini.schemes.${lang}`

export function cacheSchemes(lang, payload) {
  try {
    localStorage.setItem(
      KEY(lang),
      JSON.stringify({ savedAt: Date.now(), ...payload }),
    )
  } catch {
    // Storage full or blocked. The app still works online.
  }
}

export function getCachedSchemes(lang) {
  try {
    const raw = localStorage.getItem(KEY(lang))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// The three built in to the bundle. Every other language is learned from
// /api/languages and kept in localStorage by LanguageContext, so a user who has
// opened the app once can still switch out of a language they cannot read while
// completely offline.
const BUILTIN_LANG_WORDS = {
  hi: ['हिंदी', 'हिन्दी', 'hindi'],
  en: ['अंग्रेज़ी', 'अंग्रेजी', 'इंग्लिश', 'इंग्रजी', 'english', 'angrezi'],
  mr: ['मराठी', 'marathi'],
}

const REGISTRY_KEY = 'gramini.languages'

function langWords() {
  const words = { ...BUILTIN_LANG_WORDS }
  try {
    const raw = localStorage.getItem(REGISTRY_KEY)
    const registry = raw ? JSON.parse(raw) : null
    if (registry) {
      for (const [code, entry] of Object.entries(registry)) {
        const aliases = entry?.aliases
        if (Array.isArray(aliases) && aliases.length) {
          words[code] = [...(words[code] || []), ...aliases]
        } else if (entry?.label) {
          words[code] = [...(words[code] || []), String(entry.label).toLowerCase()]
        }
      }
    }
  } catch {
    // Fall back to the built-in three.
  }
  return words
}

// Mirrors _SWITCH_WORDS in backend/intent.py, including the non-Hindi verbs: a
// Tamil speaker asks for Tamil IN Tamil, while the app is still in Hindi.
const SWITCH_WORDS = [
  'कर दो', 'करो', 'कर दे', 'में कर', 'बदल', 'चेंज', 'में बात',
  'बोल', 'बोलो', 'बोलिए', 'सांग', 'सांगा', 'मध्ये कर', 'बदला', 'कर',
  'change', 'switch', 'speak', 'talk', 'set to', 'make it',
  // What the recogniser writes for a switch said in the "other" script: see
  // the matching note in backend/intent.py.
  'स्पीक', 'टॉक', 'स्विच',
  'bolo', 'boliye', 'bolie', 'bola', 'baat', 'badlo', 'badal do', 'sanga',
  'বল', 'বলুন', 'কথা বল', 'কও', 'କୁହ', 'କଥା',
  'మాట్లాడు', 'చెప్పు', 'ಮಾತಾಡು', 'ಹೇಳು', 'பேசு', 'சொல்', 'സംസാരിക്കൂ', 'പറയൂ',
  'બોલો', 'વાત', 'ਬੋਲੋ', 'ਗੱਲ', 'بولو', 'بات',
]

const REPEAT_WORDS = ['फिर से', 'दोबारा', 'दुबारा', 'पुन्हा', 'परत सांग', 'repeat', 'say again']

// Mirrors _CHAT_MODE_WORDS / _VOICE_MODE_WORDS in backend/intent.py. Controlling
// the interface by voice must not stop working when the network does.
const CHAT_MODE_WORDS = [
  'चैट मोड', 'लिखकर बात', 'लिख कर बात', 'लिखने वाला', 'टाइप करके', 'कीबोर्ड',
  'लिखना है', 'चॅट मोड', 'लिहून बोल', 'टाइप करून',
  'chat mode', 'text mode', 'typing mode', 'keyboard mode', 'let me type',
  'i want to type', 'write instead',
]

const VOICE_MODE_WORDS = [
  'वॉयस मोड', 'वॉइस मोड', 'आवाज़ मोड', 'आवाज मोड', 'बोलकर बात', 'बोल कर बात',
  'माइक वापस', 'माइक खोल', 'बोलना है', 'बोलून बोल',
  'voice mode', 'speak mode', 'mic mode', 'let me talk', 'i want to speak',
  'back to voice',
]

const MODE_SPEECH = {
  chat: {
    hi: 'ठीक है, अब आप लिखकर बात कर सकते हैं।',
    en: 'Okay, you can type instead now.',
    mr: 'ठीक आहे, आता तुम्ही लिहून बोलू शकता.',
  },
  voice: {
    hi: 'ठीक है, अब बोलकर बात कीजिए। माइक चालू है।',
    en: 'Okay, speak to me now. The mic is on.',
    mr: 'ठीक आहे, आता बोलून बोला. माइक चालू आहे.',
  },
}

const NO_NETWORK_CHAT = {
  hi: 'अभी इंटरनेट नहीं है, इसलिए मैं सामान्य बातचीत नहीं कर पा रहा। लेकिन सरकारी योजनाओं के बारे में अब भी पूछ सकते हैं।',
  en: 'There is no internet right now, so I cannot chat freely. But you can still ask me about government schemes.',
  mr: 'सध्या इंटरनेट नाही, त्यामुळे मी सामान्य गप्पा मारू शकत नाही. पण सरकारी योजनांबद्दल विचारू शकता.',
}

const NOT_FOUND = {
  hi: 'माफ़ कीजिए, इस योजना की पक्की जानकारी मेरे पास नहीं है। मैं अंदाज़े से नहीं बताऊँगा। अपने गाँव के CSC केंद्र से पूछिए।',
  en: 'Sorry, I do not have checked information about that scheme. I will not guess. Please ask at your village CSC centre.',
  mr: 'माफ करा, या योजनेची तपासलेली माहिती माझ्याकडे नाही. मी अंदाजाने सांगणार नाही. गावातील CSC केंद्राला विचारा.',
}

const LANG_CONFIRM = {
  hi: 'ठीक है, अब मैं हिंदी में बात करूँगा।',
  en: 'Okay, I will speak in English now.',
  mr: 'ठीक आहे, आता मी मराठीत बोलेन.',
}

const SPEECH = {
  hi: (s) =>
    `${s.name}। इसमें क्या मिलता है: ${s.what_you_get}। कौन ले सकता है: ${s.who_can_apply}। ` +
    `ज़रूरी कागज़: ${(s.papers_needed || []).join(', ')}। कैसे लें: ${s.how_to_apply}। ` +
    `यह जानकारी सरकारी वेबसाइट ${s.official_link} से ली गई है।`,
  en: (s) =>
    `${s.name}. What you get: ${s.what_you_get}. Who can apply: ${s.who_can_apply}. ` +
    `Papers needed: ${(s.papers_needed || []).join(', ')}. How to apply: ${s.how_to_apply}. ` +
    `This information comes from the official website ${s.official_link}.`,
  mr: (s) =>
    `${s.name}. यात काय मिळते: ${s.what_you_get}. कोण घेऊ शकते: ${s.who_can_apply}. ` +
    `आवश्यक कागदपत्रे: ${(s.papers_needed || []).join(', ')}. कसे मिळवायचे: ${s.how_to_apply}. ` +
    `ही माहिती सरकारी संकेतस्थळ ${s.official_link} वरून घेतली आहे.`,
}

const has = (text, words) => words.some((word) => text.includes(word))

const confirmKey = (code) => `gramini.confirm.${code}`

/**
 * Remember how the server confirmed a language switch, so the same sentence can
 * be spoken later with no network. Without this, switching to Tamil offline
 * would confirm in Hindi - which is the one moment the user most needs to hear
 * their own language.
 */
export function rememberLangConfirm(code, speech) {
  if (!code || !speech || LANG_CONFIRM[code]) return
  try {
    localStorage.setItem(confirmKey(code), speech)
  } catch {
    // ignore
  }
}

function langConfirm(code) {
  if (LANG_CONFIRM[code]) return LANG_CONFIRM[code]
  try {
    const saved = localStorage.getItem(confirmKey(code))
    if (saved) return saved
  } catch {
    // ignore
  }
  return LANG_CONFIRM.hi
}

// Mirrors _STOPWORDS in backend/schemes.py. Words that appear in nearly every
// scheme carry no signal - without dropping them, "laptop subsidy YOJANA" scores
// against every scheme whose name contains "yojana" and we return a confident
// wrong answer.
const STOPWORDS = new Set([
  'योजना', 'सरकारी', 'सरकार', 'बताओ', 'बताइए', 'बता', 'चाहिए', 'मुझे', 'क्या',
  'कैसे', 'कहाँ', 'कहां', 'मिलेगा', 'मिलेगी', 'करें', 'सांगा', 'पाहिजे', 'काय',
  'scheme', 'schemes', 'government', 'tell', 'about', 'the', 'and', 'for',
  'what', 'how', 'where', 'please', 'want', 'need', 'give', 'info',
  'information', 'yojana', 'sarkari',
])

// Below this, say "I do not know" rather than return the least-wrong scheme.
const MIN_SCORE = 4

const contentTokens = (text) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\wऀ-ॿ]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  )

function searchCached(query, lang) {
  const cached = getCachedSchemes(lang)
  if (!cached?.schemes?.length) return []

  const q = query.toLowerCase().trim()
  if (!q) return []

  const qTokens = contentTokens(q)
  if (!qTokens.size) return []

  const scored = cached.schemes
    .map((scheme) => {
      // `strong` and `weak` are kept apart for the same reason as in
      // backend/schemes.py: only curated signals may CREATE a match.
      let strong = 0
      const name = (scheme.name || '').toLowerCase()
      if (name && q.includes(name)) strong += 15

      // Same keyword scoring as backend/schemes.py, using the keyword lists the
      // server ships inside the cached pack. This is what keeps an offline
      // answer identical to an online one.
      for (const [kwLang, words] of Object.entries(scheme.keywords || {})) {
        for (const kw of words) {
          const kwN = String(kw).toLowerCase().trim()
          if (!kwN) continue
          if (q.includes(kwN)) {
            strong += kwLang === lang ? 10 : 7
            continue
          }
          const kwTokens = contentTokens(kwN)
          if (kwTokens.size && [...kwTokens].every((t) => qTokens.has(t))) {
            strong += kwLang === lang ? 6 : 4
          }
        }
      }

      // Never match on descriptive prose alone. "mujhe laptop ke liye sarkari
      // paisa chahiye" used to score exactly 4 against crop insurance on the
      // words "paisa" and "liye" and return it as a confident answer.
      if (strong <= 0) return { score: 0, scheme }

      // Whole-word matching, not substring: a substring test let "tell" match
      // "telling" and handed English queries to the wrong scheme.
      const haystack = contentTokens(
        [scheme.name, scheme.what_you_get, scheme.who_can_apply, scheme.how_to_apply]
          .filter(Boolean)
          .join(' '),
      )
      let weak = 0
      for (const token of qTokens) {
        if (haystack.has(token)) weak += 2
      }

      return { score: strong + weak, scheme }
    })
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)

  return scored.map((entry) => entry.scheme)
}

/** Same response shape as POST /api/turn, produced entirely on the device. */
export function localTurn(text, lang) {
  const lowered = (text || '').toLowerCase().trim()
  const base = {
    intent: 'GENERAL_CHAT',
    intent_source: 'offline',
    transcript: text,
    lang,
    action: null,
    scheme: null,
    others: [],
    data_status: getCachedSchemes(lang)?.data_status || 'sample',
  }

  // The headline feature must work with zero network. It does.
  //
  // Longest alias wins, exactly as in backend/languages.py: without that,
  // 'hindi' inside a longer language name could beat the more specific match.
  if (has(lowered, SWITCH_WORDS)) {
    let best = null
    for (const [code, words] of Object.entries(langWords())) {
      for (const word of words) {
        const alias = String(word).toLowerCase()
        if (alias && lowered.includes(alias)) {
          if (!best || alias.length > best.length) best = { code, length: alias.length }
        }
      }
    }
    if (best) {
      return {
        ...base,
        intent: 'CHANGE_UI_LANGUAGE',
        action: 'CHANGE_UI_LANGUAGE',
        lang: best.code,
        speech: langConfirm(best.code),
      }
    }
  }

  for (const [mode, words] of [['chat', CHAT_MODE_WORDS], ['voice', VOICE_MODE_WORDS]]) {
    if (has(lowered, words)) {
      const bundle = MODE_SPEECH[mode]
      return {
        ...base,
        intent: 'SET_MODE',
        action: 'SET_MODE',
        mode,
        speech: bundle[lang] || bundle.hi,
      }
    }
  }

  if (has(lowered, REPEAT_WORDS)) {
    return { ...base, intent: 'REPEAT_LAST', action: 'REPEAT_LAST', speech: '' }
  }

  const matches = searchCached(lowered, lang)
  if (matches.length) {
    const [best, ...rest] = matches
    return {
      ...base,
      intent: 'SCHEME_QUERY',
      action: 'SHOW_SCHEME',
      scheme: best,
      others: rest.slice(0, 2),
      speech: (SPEECH[lang] || SPEECH.hi)(best),
    }
  }

  // Nothing matched and there is no network. Say so - do not invent an answer.
  const cached = getCachedSchemes(lang)
  return {
    ...base,
    speech: cached ? NOT_FOUND[lang] || NOT_FOUND.hi : NO_NETWORK_CHAT[lang] || NO_NETWORK_CHAT.hi,
  }
}
