import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatComposer } from './components/ChatComposer'
import { Header } from './components/Header'
import { HomeScreen } from './components/HomeScreen'
import { StartScreen } from './components/StartScreen'
import { useAiStatus } from './hooks/useAiStatus'
import { useServiceHealth } from './hooks/useServiceHealth'
import { ServiceChips } from './components/ServiceChips'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LanguageNotices } from './components/LanguageNotices'
import { OfflineBanner } from './components/OfflineBanner'
import { QuickActionGrid } from './components/QuickActionGrid'
import { VoiceController } from './components/VoiceController'
import { ChatStream } from './components/ChatStream'
import { VisionMode } from './components/VisionMode'
import { useLang } from './context/LanguageContext'
import { useVoice } from './hooks/useVoice'
import { useOnline } from './hooks/useOnline'
import { lookupScheme, readImage, sendTurn, syncSchemes } from './lib/api'
import { bcp47For } from './lib/voices'

let messageId = 0
const nextId = () => {
  messageId += 1
  return messageId
}

const LARGE_TEXT_KEY = 'gramini.largeText'
const STARTED_KEY = 'gramini.started'
const THEME_KEY = 'gramini.theme'
const CONTRAST_KEY = 'gramini.contrast'

const readStored = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** Why a photo could not be read, in words the user can act on. */
function imageFailureText(reason, t) {
  switch (reason) {
    case 'bad_key':
    case 'no_key':
    case 'no_sdk':
    case 'forbidden':
    case 'bad_model':
      return t.imageErrConfig
    case 'quota':
    case 'busy':
      return t.imageErrBusy
    case 'timeout':
      return t.imageErrSlow
    case 'bad_image':
      return t.imageErrBadImage
    case 'empty':
      return t.imageErrUnclear
    case 'offline':
    case 'network':
    case 'dns':
      return t.imageNoAi
    default:
      return t.imageErrGeneric
  }
}

export default function App() {
  const { lang, setLang, bcp47, t } = useLang()
  const online = useOnline()
  const { aiReady, dataStatus: healthDataStatus } = useAiStatus()
  // Per-service readout: which parts are live, cached, or out.
  const serviceHealth = useServiceHealth(online)

  const [messages, setMessages] = useState([])
  const [dataStatus, setDataStatus] = useState('sample')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraBusy, setCameraBusy] = useState(false)

  /**
   * 'voice' is the designed mode: one big mic, hands free. 'chat' is the typed
   * fallback, reachable by SAYING "let me type" - the voice controls the
   * interface, not just the questions.
   */
  const [mode, setMode] = useState('voice')

  /**
   * Hands-free: after the app finishes speaking, the mic reopens by itself and
   * keeps the conversation going until the user stops it.
   *
   * It cannot begin on page load. Chrome blocks both speech synthesis and
   * microphone access until the page has had a real user gesture, so the first
   * tap is the browser's price, not a design choice. After that single tap the
   * user never presses anything again.
   */
  const [started, setStarted] = useState(false)
  const [handsFree, setHandsFree] = useState(true)
  const handsFreeRef = useRef(true)
  useEffect(() => { handsFreeRef.current = handsFree }, [handsFree])

  /**
   * ChatGPT's type scale (16-17px) is comfortable for a literate desktop user
   * and too small for the elderly, low-literacy users this app is for. Rather
   * than pick one and lose the other, the whole interface scales from the root
   * font size: 100% for the ChatGPT look, 118% for the accessible sizing
   * (~20px body, ~57px tap targets). The choice is the user's, which is better
   * HCI than either fixed value.
   */
  const [largeText, setLargeText] = useState(() => {
    try {
      return localStorage.getItem(LARGE_TEXT_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    document.documentElement.style.fontSize = largeText ? '118%' : '100%'
    try {
      localStorage.setItem(LARGE_TEXT_KEY, largeText ? '1' : '0')
    } catch {
      // ignore
    }
  }, [largeText])

  /**
   * Light by default, not dark.
   *
   * A village phone is used outdoors in daylight far more often than in the
   * dark, and a dark interface in direct sun is close to unreadable. Dark and
   * high-contrast are both opt-in, and both are pure presentation - they set a
   * data attribute on <html> and the CSS variables in index.css do the rest.
   */
  const [theme, setTheme] = useState(() => readStored(THEME_KEY, 'light'))
  const [highContrast, setHighContrast] = useState(
    () => readStored(CONTRAST_KEY, '0') === '1',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    if (highContrast) root.setAttribute('data-contrast', 'high')
    else root.removeAttribute('data-contrast')
    try {
      localStorage.setItem(CONTRAST_KEY, highContrast ? '1' : '0')
    } catch {
      // ignore
    }
  }, [highContrast])

  // Kept in a ref so REPEAT_LAST works without re-creating callbacks.
  const lastSpeechRef = useRef('')
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])

  const pushMessage = useCallback((message) => {
    // `at` drives the timestamp under each bubble. Stamped here rather than in
    // the view so a re-render cannot change it.
    setMessages((prev) => [...prev, { id: nextId(), at: Date.now(), ...message }])
  }, [])

  // ------------------------------------------------------------------ voice out

  const voiceRef = useRef(null)
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])

  /**
   * Speak, then hand the microphone straight back to the user.
   *
   * This one callback is what makes the app a conversation rather than a
   * sequence of button presses. The mic is only reopened once the utterance has
   * genuinely ended, which is what stops the app from hearing itself - the
   * anti-echo guard in useVoice does the rest.
   */
  const say = useCallback((text, { listenAfter = true, lang } = {}) => {
    if (!text) return
    lastSpeechRef.current = text
    voiceRef.current?.speak(text, {
      // Passed through so a turn that CHANGES the language speaks in the new
      // one. Without it the utterance is queued before React has re-rendered,
      // so it would use the previous language's voice.
      lang,
      then: () => {
        if (!listenAfter) return
        if (!handsFreeRef.current) return
        if (modeRef.current !== 'voice') return
        // A real pause before the mic opens. 350ms was not enough: laptop
        // speakers are still ringing, and the app caught the tail of its own
        // sentence. It also gives an elderly user a moment to gather a thought
        // rather than being cut off by an instant beep.
        setTimeout(() => {
          if (!handsFreeRef.current || modeRef.current !== 'voice') return
          // Never open the mic if speech somehow restarted in the meantime.
          if (window.speechSynthesis?.speaking) return
          voiceRef.current?.startListening()
        }, 900)
      },
    })
  }, [])

  /**
   * Everything the backend (or the offline fallback) can tell us to do, in one
   * place. Taps and speech both land here.
   */
  const applyResult = useCallback(
    (result) => {
      if (!result) return

      if (result.data_status) setDataStatus(result.data_status)

      // The user simply spoke a different language and the backend noticed.
      // Nobody asked for a switch, so there is no confirmation sentence - the
      // answer itself just arrives in their language, which is the point.
      // The language this answer must be SPOKEN in. Read from the response
      // rather than from state, because state has not updated yet in this tick.
      const spokenLang = result.detected_language || result.lang || langRef.current
      const bcp47ForTurn = bcp47For(spokenLang)

      if (result.detected_language && result.detected_language !== langRef.current) {
        setLang(result.detected_language)
      }

      if (result.action === 'CHANGE_UI_LANGUAGE') {
        // The headline moment: the whole UI re-renders, then the app confirms
        // in the NEW language so the user hears that it worked.
        setLang(result.lang)
        pushMessage({ role: 'ai', text: result.speech })
        // The language is passed explicitly rather than relying on the delay:
        // a timer that is "usually long enough" is how this bug shipped.
        setTimeout(() => say(result.speech, { lang: bcp47For(result.lang) }), 120)
        return
      }

      if (result.action === 'SET_MODE') {
        setMode(result.mode === 'chat' ? 'chat' : 'voice')
        pushMessage({ role: 'ai', text: result.speech })
        // Going to chat mode ends hands-free listening: someone who asked to
        // type is telling us the microphone is not working for them.
        say(result.speech, { listenAfter: result.mode !== 'chat', lang: bcp47ForTurn })
        return
      }

      if (result.action === 'CAMERA_OPEN') {
        pushMessage({ role: 'ai', text: result.speech })
        // The camera takes over the screen; reopening the mic behind it would
        // have the app listening to a user who is lining up a photo.
        say(result.speech, { listenAfter: false, lang: bcp47ForTurn })
        setCameraOpen(true)
        return
      }

      if (result.action === 'REPEAT_LAST') {
        if (lastSpeechRef.current) say(lastSpeechRef.current)
        return
      }

      pushMessage({
        role: 'ai',
        text: result.speech,
        scheme: result.scheme || null,
        others: result.others || [],
        // Every match, best first. "Which schemes can I get?" has more than one
        // right answer, so the UI shows them all rather than the top one.
        schemes: result.schemes || (result.scheme ? [result.scheme] : []),
        // Rendered as a WeatherCard when present. The backend already returns
        // these; the UI simply stopped throwing them away.
        weather: result.weather || null,
        cached: result.cached || false,
        cacheAgeSeconds: result.cache_age_seconds ?? null,
        offline: result.offline || false,
      })
      say(result.speech, { lang: bcp47ForTurn })
    },
    [pushMessage, say, setLang],
  )

  // ------------------------------------------------------------------- voice in

  const handleTranscript = useCallback(
    async (text) => {
      pushMessage({ role: 'user', text })
      const result = await sendTurn(text, langRef.current)
      applyResult(result)
    },
    [applyResult, pushMessage],
  )

  // Typed input takes the same path as speech, so chat mode is not a second
  // implementation that can drift from the voice one.
  const handleTyped = useCallback(
    async (text) => {
      pushMessage({ role: 'user', text })
      const result = await sendTurn(text, langRef.current)
      applyResult(result)
    },
    [applyResult, pushMessage],
  )

  const voice = useVoice({
    bcp47,
    onFinalTranscript: handleTranscript,
    // Drives the voice fallback ladder: offline, only device-local voices
    // can actually make sound, so the hook drops to recorded audio instead.
    online,
  })

  // Assigned in an effect rather than during render, so StrictMode's double
  // render cannot leave `say()` holding a stale voice handle.
  useEffect(() => { voiceRef.current = voice })

  // ------------------------------------------------------------------- actions

  const handleQuickAction = useCallback(
    async ({ utterance, category }) => {
      pushMessage({ role: 'user', text: utterance })
      voice.setState('thinking')

      // Chips with a category skip intent parsing entirely - a tap is not
      // ambiguous, so there is nothing for a model to classify. Faster, and it
      // still works when Gemini is unreachable.
      const result = category
        ? await lookupScheme({ category, lang: langRef.current })
        : await sendTurn(utterance, langRef.current)

      applyResult(result)
    },
    [applyResult, pushMessage, voice],
  )

  const handlePickOther = useCallback(
    async (schemeId) => {
      voice.setState('thinking')
      const result = await lookupScheme({ schemeId, lang: langRef.current })
      applyResult(result)
    },
    [applyResult, voice],
  )

  const handleRepeat = useCallback(
    (message) => {
      const text = message?.text || lastSpeechRef.current
      if (text) say(text)
    },
    [say],
  )

  const handleCapture = useCallback(
    async (dataUrl) => {
      setCameraBusy(true)
      try {
        const result = await readImage(dataUrl, langRef.current)
        if (!result.ok) console.warn('[vision] analysis failed:', result.reason || 'unknown')
        const text = result.ok ? result.speech : imageFailureText(result.reason, t)
        setCameraOpen(false)
        // Task 6: the photo stays in the conversation whether or not the model
        // could read it, so a failed analysis never looks like a failed camera.
        pushMessage({
          role: 'ai',
          text,
          image: dataUrl,
          offline: !result.ok,
        })
        say(text)
      } finally {
        setCameraBusy(false)
      }
    },
    [pushMessage, say, t],
  )

  // ------------------------------------------------------------ hands-free start

  /**
   * The one tap the browser insists on, and the last one the user makes.
   *
   * From here the app greets them out loud and then listens by itself, turn
   * after turn, with nothing more to press.
   */
  const handleStart = useCallback(() => {
    setStarted(true)
    setHandsFree(true)
    try {
      localStorage.setItem(STARTED_KEY, '1')
    } catch {
      // ignore
    }
    const greeting = `${t.spokenGreeting}`
    pushMessage({ role: 'ai', text: greeting })
    // The gesture is still "fresh" here, which is what lets speech start at all.
    say(greeting)
  }, [pushMessage, say, t])

  const stopHandsFree = useCallback(() => {
    setHandsFree(false)
    voiceRef.current?.stopListening()
    voiceRef.current?.stopSpeaking()
  }, [])

  // ---------------------------------------------------------------- scheme sync

  // Pull the scheme pack for the current language and keep it on the device, so
  // the app keeps answering when the network goes. Re-runs on language change.
  useEffect(() => {
    let cancelled = false
    syncSchemes(lang).then((data) => {
      if (!cancelled && data?.data_status) setDataStatus(data.data_status)
    })
    return () => { cancelled = true }
  }, [lang])

  const empty = messages.length === 0

  // ----------------------------------------------------------------------- view

  return (
    <div className="flex h-screen flex-col bg-sunken">
      <Header
        dataStatus={dataStatus}
        largeText={largeText}
        onToggleLargeText={() => setLargeText((v) => !v)}
        theme={theme}
        onToggleTheme={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
        highContrast={highContrast}
        onToggleContrast={() => setHighContrast((v) => !v)}
        online={online}
        aiReady={aiReady}
        usingCache={messages.some((m) => m.cached)}
      />
      <OfflineBanner online={online} />
      <ServiceChips health={serviceHealth} />
      <LanguageNotices voiceAvailable={voice.voiceAvailable} voiceBlocked={voice.voiceBlocked} />
      {voice.micFailed && (
        <div role="status" className="border-b border-saffron/40 bg-saffron-soft px-4 py-2 text-center text-sm font-semibold text-saffron-ink">
          <span aria-hidden="true">🎤</span> {voice.micFailed === 'denied' ? t.micDenied : t.micUnavailable}{' '}
          <button type="button" onClick={() => { voice.clearMicFailed(); setMode('chat'); stopHandsFree() }}
            className="underline underline-offset-4">{t.chatMode}</button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-thread px-4">
          {empty ? (
            /* Voice first: one enormous microphone, then the four doors. */
            <HomeScreen
              voiceState={voice.state}
              interim={voice.interim}
              onStart={() => {
                setHandsFree(true)
                voice.startListening()
              }}
              onStop={stopHandsFree}
              onPick={handleQuickAction}
              disabled={voice.state === 'thinking'}
            />
          ) : (
            <ErrorBoundary>
            <ChatStream
              messages={messages}
              onPickOther={handlePickOther}
              onRepeat={handleRepeat}
              thinking={voice.state === 'thinking'}
            />
            </ErrorBoundary>
          )}
        </div>
      </main>

      {/* Composer pinned to the bottom. The quick actions stay reachable above
          it once a conversation starts, so the four entry points never vanish. */}
      <div className="shrink-0 border-t border-line bg-surface pb-3 pt-2">
        {!empty && (
          <div className="mx-auto max-w-thread">
            <QuickActionGrid
              onPick={handleQuickAction}
              disabled={voice.state === 'thinking'}
              variant="strip"
            />
          </div>
        )}

        <div className="mx-auto w-full max-w-thread px-4">
          {mode === 'chat' ? (
            <ChatComposer
              onSend={handleTyped}
              onVoiceMode={() => {
                setMode('voice')
                setHandsFree(true)
              }}
              disabled={voice.state === 'thinking'}
            />
          ) : (
            <>
              <VoiceController
                state={voice.state}
                interim={voice.interim}
                supported={voice.supported}
                onStart={() => {
                  setHandsFree(true)
                  voice.startListening()
                }}
                onStop={stopHandsFree}
                onCamera={() => setCameraOpen(true)}
              />

              <div className="mt-2 flex items-center justify-center gap-3">
                {handsFree && voice.state !== 'idle' && (
                  <span className="text-sm text-muted">
                    <span aria-hidden="true">🔄</span> {t.handsFreeOn}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMode('chat')
                    stopHandsFree()
                  }}
                  className="rounded-full border border-line px-3 py-1 text-sm font-semibold text-muted transition-colors hover:bg-hover"
                >
                  ⌨️ {t.chatMode}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {!started && <StartScreen onStart={handleStart} />}

      <VisionMode
        open={cameraOpen}
        busy={cameraBusy}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
      />
    </div>
  )
}
