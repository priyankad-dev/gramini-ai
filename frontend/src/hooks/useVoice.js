import { useCallback, useEffect, useRef, useState } from 'react'
import {
  currentVoices,
  hasNativeVoice,
  loadVoices,
  logVoiceChoice,
  pickVoice,
  watchVoices,
  voiceCanRead,
} from '../lib/voices'
import { chunkForSpeech } from '../lib/speechQueue'
import { findClip, loadManifest, paragraphsOf, playClip } from '../lib/audioCache'

/**
 * Speech in and speech out, with the anti-echo loop.
 *
 * The hard part of a voice app is not recognition, it is stopping the app from
 * hearing itself. Browsers will happily feed the phone's own text-to-speech
 * back into the microphone, so the app answers its own answer forever.
 *
 * The fix here is a single `busyRef` flag plus an explicit abort:
 *   speak()  ->  abort recognition, mark busy, then speak
 *   onend    ->  clear busy, and only then allow listening again
 *
 * States: 'idle' | 'listening' | 'thinking' | 'speaking'
 */
/** Words a transcript and a spoken sentence have in common, as a 0-1 share.
 *
 * \p{M} matters: in Devanagari and every other Indic script the vowel signs are
 * Unicode MARKS, not letters. Splitting on \p{L} alone tears "किस्तों" into
 * fragments, so two identical sentences can score zero overlap - which would
 * silently switch the echo filter off for exactly the languages this app is for.
 */
function overlap(heard, spoken) {
  const words = (text) =>
    new Set(
      String(text)
        .toLowerCase()
        .split(/[^\p{L}\p{N}\p{M}]+/u)
        .filter((word) => word.length > 2),
    )
  const a = words(heard)
  const b = words(spoken)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / a.size
}

let voiceListWaited = false

export function useVoice({ bcp47, onFinalTranscript, online = true }) {
  const [state, setState] = useState('idle')
  const [interim, setInterim] = useState('')
  const [supported, setSupported] = useState(true)
  // Whether this device can actually SPEAK the current language. Recognition
  // and synthesis are separate: Chrome will happily listen in Tamil on a laptop
  // that owns no Tamil voice, then answer in silence. Silence is the worst
  // possible failure for a voice-first app, because it looks like a crash.
  const [voiceAvailable, setVoiceAvailable] = useState(true)
  // True only when NOTHING can speak: no offline voice and no recording.
  // Drives the explicit "Voice unavailable in offline mode" notice.
  const [voiceBlocked, setVoiceBlocked] = useState(false)
  // Recognition gave up or never answered. Drives the "please type" notice.
  const [micFailed, setMicFailed] = useState(false)

  const recognitionRef = useRef(null)
  const busyRef = useRef(false)        // true while the app is speaking
  const wantListenRef = useRef(false)  // user pressed the mic and has not cancelled
  const langRef = useRef(bcp47)
  const finalCbRef = useRef(onFinalTranscript)
  const lastSpokenRef = useRef('')     // the sentence we last read aloud
  const spokenAtRef = useRef(0)        // when that sentence finished
  const queueIdRef = useRef(0)         // invalidates an in-flight speech queue
  const onlineRef = useRef(online)
  const cancelClipRef = useRef(null)   // stops a recorded clip mid-play
  const listenTimerRef = useRef(null)  // hard stop for a mic that never returns

  const startListeningRef = useRef(null)
  useEffect(() => {
    if (langRef.current === bcp47) return undefined
    langRef.current = bcp47
    // `recognition.lang` is read when a session STARTS. A language picked while
    // the mic is already open would otherwise only apply from the next turn,
    // and this whole sentence would be transcribed in the old language.
    if (!wantListenRef.current || busyRef.current) return undefined
    try {
      recognitionRef.current?.abort()
    } catch {
      // already stopped
    }
    const timer = setTimeout(() => {
      if (wantListenRef.current) startListeningRef.current?.()
    }, 250)
    return () => clearTimeout(timer)
  }, [bcp47])
  useEffect(() => { onlineRef.current = online }, [online])
  // Fetched while online, kept in localStorage - looking up what recordings
  // exist must not itself need a network.
  useEffect(() => { loadManifest() }, [])
  useEffect(() => { finalCbRef.current = onFinalTranscript }, [onFinalTranscript])

  // ---------------------------------------------------------------- recognition

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      return
    }

    const recognition = new SR()
    recognition.continuous = false      // stop on silence: villagers speak in bursts
    recognition.interimResults = true   // show words as they arrive, so it feels alive
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += chunk
        else interimText += chunk
      }
      setInterim(interimText)
      const heard = finalText.trim()
      if (!heard) return

      // Second echo guard, independent of the timing one.
      //
      // Even with the mic shut during playback, a laptop speaker in a hard room
      // gets back into the microphone. Without this the app hears its own
      // answer, treats it as a question, answers that, and loops forever - which
      // on stage looks exactly like the app having a breakdown.
      //
      // Only applied for a few seconds after we stop talking, and only when most
      // of what was heard also appears in what we just said, so a user who
      // genuinely repeats a phrase back is not ignored.
      const sinceSpoke = Date.now() - spokenAtRef.current
      if (sinceSpoke < 4000 && overlap(heard, lastSpokenRef.current) > 0.6) {
        setInterim('')
        return
      }

      setInterim('')
      wantListenRef.current = false
      if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null }
      setMicFailed(false)
      setState('thinking')
      finalCbRef.current?.(heard)
    }

    recognition.onerror = (event) => {
      // 'aborted' is us stopping it on purpose before speaking. Not an error.
      if (event.error === 'aborted') return
      console.warn(
        `[Gramini] service=speechRecognition reason=${event.error} ` +
          'recovery=stopped listening, text input still available',
      )
      // 'network' and 'service-not-allowed' mean recognition cannot work at all
      // here - recognition is a server-side service, so it is the first thing
      // to die when the connection does.
      // 'not-allowed' is the microphone permission itself: blocked for the
      // site, or the prompt dismissed. It gets its own message, because "type
      // instead" alone does not tell the user that one setting would fix it.
      if (event.error === 'not-allowed') {
        setMicFailed('denied')
      } else if (['network', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        setMicFailed(true)
      }
      if (listenTimerRef.current) { clearTimeout(listenTimerRef.current); listenTimerRef.current = null }
      wantListenRef.current = false
      setInterim('')
      setState('idle')
    }

    recognition.onend = () => {
      setInterim('')
      // Only drop to idle if we are not mid-answer.
      setState((prev) => (prev === 'listening' ? 'idle' : prev))
    }

    recognitionRef.current = recognition
    return () => {
      try {
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
        recognition.abort()
      } catch {
        // already dead
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current)
      listenTimerRef.current = null
    }
    wantListenRef.current = false
    try {
      recognitionRef.current?.abort()
    } catch {
      // ignore
    }
    setInterim('')
    setState((prev) => (prev === 'listening' ? 'idle' : prev))
  }, [])

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return

    // Never open the mic while the phone is talking. This is the anti-echo rule.
    if (busyRef.current) {
      window.speechSynthesis?.cancel()
      busyRef.current = false
    }

    wantListenRef.current = true
    recognition.lang = langRef.current

    /*
      Task 3: a hard ceiling on listening.

      Chrome's SpeechRecognition can enter a state where it neither returns a
      result nor fires onend - most often when the network drops mid-session,
      because recognition is a SERVER-side service. The UI would then sit on
      "Listening..." forever with no way out but a reload. This guarantees the
      mic always comes back, and tells the user to type instead.
    */
    if (listenTimerRef.current) clearTimeout(listenTimerRef.current)
    listenTimerRef.current = setTimeout(() => {
      listenTimerRef.current = null
      if (!wantListenRef.current) return
      console.warn(
        '[Gramini] service=speechRecognition reason=no-result-within-15s ' +
          'recovery=stopped listening, offering text input',
      )
      wantListenRef.current = false
      try {
        recognition.abort()
      } catch {
        // already dead
      }
      setInterim('')
      setState('idle')
      setMicFailed(true)
    }, 15000)

    try {
      recognition.start()
      setState('listening')
    } catch {
      // start() throws if it is already running. Restart cleanly.
      try {
        recognition.abort()
        setTimeout(() => {
          if (!wantListenRef.current) return
          try {
            recognition.start()
            setState('listening')
          } catch {
            setState('idle')
          }
        }, 180)
      } catch {
        setState('idle')
      }
    }
  }, [])
  useEffect(() => { startListeningRef.current = startListening }, [startListening])

  // ------------------------------------------------------------------- speaking

  /**
   * `lang` overrides the hook's current language for this utterance only.
   *
   * It exists because of a race that is invisible until you hit it: when the
   * backend switches language, App calls setLang() and then say() in the SAME
   * tick. React has not re-rendered yet, so the effect that syncs langRef has
   * not run, and the utterance would be spoken with the PREVIOUS language's
   * voice - the exact symptom of "the UI changed but the voice did not".
   * Passing the language explicitly removes the timing question entirely.
   */
  const speakRef = useRef(null)
  const speak = useCallback((text, options = {}) => {
    const { then, lang } = options
    const synth = window.speechSynthesis
    if (!text || !synth) {
      setState('idle')
      then?.()
      return
    }

    // Chrome returns an EMPTY voice list until 'voiceschanged' fires. Picking a
    // voice from that list chose nothing, so the first answer after page load
    // fell through to recordings or silence. Wait for the list once (loadVoices
    // gives up after 2.5s), then speak with a properly chosen voice.
    if (!currentVoices().length && !options.voicesWaited && !voiceListWaited) {
      try {
        recognitionRef.current?.abort()
      } catch {
        // ignore
      }
      wantListenRef.current = false
      busyRef.current = true
      setState('speaking')
      queueIdRef.current += 1
      const waitId = queueIdRef.current
      loadVoices().then(() => {
        // Once per page: a device with no voices at all must not pay 2.5s per answer.
        voiceListWaited = true
        if (waitId !== queueIdRef.current) return // stopped or superseded
        speakRef.current?.(text, { ...options, voicesWaited: true })
      })
      return
    }

    // 1. Shut the microphone before a single word comes out of the speaker.
    try {
      recognitionRef.current?.abort()
    } catch {
      // ignore
    }
    wantListenRef.current = false
    synth.cancel()

    busyRef.current = true
    setState('speaking')

    const speakLang = lang || langRef.current

    /*
      Choose the voice FRESH, and once for the whole answer.

      Never cached across answers: the language changes mid-conversation by
      design, so a voice remembered from last time is exactly the bug. Setting
      only `utterance.lang` is not enough either - leaving `voice` null does not
      make the browser honour the tag, it uses the system default, which is
      almost always English.
    */
    const offline = !onlineRef.current
    const voices = currentVoices()
    const picked = pickVoice(speakLang, voices, { offline })
    logVoiceChoice(speakLang, picked, voices)
    setVoiceAvailable(picked.exact)

    console.info(
      `[Gramini TTS] internet=${offline ? 'OFFLINE' : 'online'} ` +
        `engine=speechSynthesis lang=${speakLang} ` +
        `browserVoice="${picked.voice?.name || 'none'}" ` +
        `local=${picked.voice?.localService ?? '-'} match=${picked.reason} ` +
        `quality=${picked.quality ?? '-'}${picked.poor ? ' (rough)' : ''}`,
    )

    // Remember the whole answer, so a transcript that turns out to be our own
    // voice can be recognised and thrown away.
    lastSpokenRef.current = text

    /*
      Speak in CHUNKS, one at a time.

      A single long utterance is not reliable: Chrome stops after roughly 15
      seconds and fires neither onend nor onerror, so the voice dies mid-sentence
      and the hands-free loop hangs waiting for a callback that never comes. A
      nine-scheme answer is about two minutes, so it hit this every time - the
      "speaks only the first scheme, then stops" symptom.

      Each chunk waits for the previous one's onend. `then` fires only after the
      LAST chunk, which is what keeps the microphone shut for the whole answer.
    */
    const chunks = chunkForSpeech(text)
    queueIdRef.current += 1
    const queueId = queueIdRef.current
    let index = 0
    let done = false
    let watchdog = null
    let keepAlive = null

    const cleanup = () => {
      if (watchdog) clearTimeout(watchdog)
      if (keepAlive) clearInterval(keepAlive)
      watchdog = null
      keepAlive = null
    }

    const finish = () => {
      if (done) return
      done = true
      cleanup()
      busyRef.current = false
      // Grace period before the mic may reopen. Speakers ring and rooms echo, so
      // a mic opened the instant audio stops still catches the tail.
      spokenAtRef.current = Date.now()
      setState('idle')
      then?.()
    }

    const speakNext = () => {
      // A newer answer started: abandon this queue silently.
      if (queueId !== queueIdRef.current) return
      if (done) return
      if (index >= chunks.length) {
        finish()
        return
      }

      const piece = chunks[index]
      index += 1

      /*
        The fallback ladder, in priority order:

          L1  the current pipeline - the right voice for the language
          L2  a browser voice that works offline (local, not Google's remote)
          L3  a recording made earlier and cached on disk
          L4  text on screen, and say so

        L1 and L2 are the same call: `pickVoice` was already given the offline
        flag, so when the network is down it has filtered out Google's REMOTE
        voices - which offline are listed but silent, and were the original bug.
        If it returned a voice, that voice can actually speak.

        Only when it returns nothing do we drop to L3.
      */
      /*
        Per-chunk script check.

        `pickVoice` already refuses a voice that cannot read the language, but
        this re-checks the ACTUAL text: an engine only pronounces the script it
        knows, so an English voice handed Devanagari reads out the digits and
        Latin acronyms and silently drops the rest - about 16% of a scheme
        answer, which sounds like the app is broken rather than degraded.

        Checked per chunk because one answer can mix scripts: a chunk that is
        only a phone number or a website is fine for any voice.
      */
      const canRead = picked.voice && voiceCanRead(picked.voice, piece)
      if (picked.voice && !canRead) {
        console.warn(
          `[Gramini TTS] service=speechSynthesis ` +
            `reason=voice "${picked.voice.name}" (${picked.voice.lang}) cannot ` +
            `read this script recovery=trying cached audio, then text`,
        )
      }

      if (!canRead) {
        findClip(piece, speakLang)
          .then((url) => {
            if (queueId !== queueIdRef.current || done) return
            if (!url) {
              // LEVEL 4 - nothing can speak this. Tell the user plainly, keep
              // the text on screen, and carry on rather than hanging the queue.
              console.warn(
                `[Gramini TTS] fallbackLevel=4 (text only) - no offline browser ` +
                  `voice and no cached audio for ${speakLang}. ` +
                  `Voice unavailable in offline mode; the answer is on screen.`,
              )
              setVoiceAvailable(false)
              setVoiceBlocked(true)
              speakNext()
              return
            }
            console.info(`[Gramini TTS] fallbackLevel=3 (cached audio) ${url}`)
            setVoiceBlocked(false)
            playClip(url, { onReady: (cancel) => { cancelClipRef.current = cancel } })
              .then(() => {
                cancelClipRef.current = null
                if (queueId !== queueIdRef.current || done) return
                setTimeout(speakNext, index < chunks.length ? 180 : 0)
              })
          })
          .catch(() => speakNext())
        return
      }

      speakWithBrowser(piece)
    }

    /**
     * LEVEL 1 / 2 - synthesise with whatever voice we settled on.
     *
     * `onDone` exists so the recorded-audio path can borrow this for a single
     * paragraph without handing control back to the chunk queue. It defaults to
     * `speakNext`, which is the ordinary flow and is unchanged.
     */
    function speakWithBrowser(piece, onDone = speakNext) {
      setVoiceBlocked(false)
      const utterance = new SpeechSynthesisUtterance(piece)
      utterance.lang = speakLang
      utterance.rate = 0.92 // slower than default: clearer for elderly listeners
      utterance.pitch = 1
      if (picked.voice) utterance.voice = picked.voice

      let advanced = false
      const advance = () => {
        if (advanced) return
        advanced = true
        cleanup()
        if (queueId !== queueIdRef.current || done) return
        // A short breath between schemes rather than a run-on wall of speech.
        setTimeout(onDone, index < chunks.length ? 180 : 0)
      }

      utterance.onend = advance
      utterance.onerror = advance

      utterance.onstart = () => {
        cleanup()
        /*
          Chrome pauses long synthesis after ~15s unless it is nudged. Calling
          resume() on a timer is the documented workaround; it is a no-op when
          nothing is paused, so it is safe to run unconditionally.
        */
        keepAlive = setInterval(() => {
          if (queueId !== queueIdRef.current || done) return
          if (synth.speaking && !synth.paused) synth.resume()
        }, 5000)

        // Generous per-chunk ceiling: chunks are ~220 characters, so this only
        // fires if the engine has genuinely stopped without telling us.
        watchdog = setTimeout(advance, 4000 + piece.length * 140)
      }

      try {
        synth.speak(utterance)
      } catch {
        advance()
        return
      }

      // If onstart never arrives AND nothing is playing, speech was blocked
      // (Chrome refuses until the page has had a user gesture, and refuses
      // silently). Checking synth.speaking distinguishes "blocked" from
      // "still warming up" - a flat timer here previously opened the microphone
      // while the app was still talking, and it transcribed its own voice.
      watchdog = setTimeout(() => {
        if (advanced || done) return
        if (synth.speaking || synth.pending) {
          watchdog = setTimeout(() => advance(), 30000)
          return
        }
        advance()
      }, 2500)
    }

    /*
      Try a recording of the WHOLE answer before chunking.

      The cache is keyed on complete sentences - one clip per scheme, as the
      backend generated them - while the speech queue works in 220-character
      pieces. Looking up a chunk would therefore never match a clip, and every
      recording in audio_cache/ would sit unused. So the full text is checked
      first, and chunking is only for text the browser has to synthesise.
    */
    const browserCanSayIt = picked.voice && voiceCanRead(picked.voice, text)

    /*
      Prefer a recording when the browser voice is ROUGH, not only when it is
      unusable.

      This is the "sounds different on someone else's laptop" bug. `getVoices()`
      is a property of the device, so one machine gets Google's neural Hindi
      voice and the next gets a formant synth. Both pass `voiceCanRead` - the
      script is right - so the second one used to go straight to the browser and
      the Gemini-recorded WAVs sat unused. Preferring the recording here is the
      only way this app can sound the same on two different machines.

      Only when the browser could have said it anyway: if it could NOT, this is
      already the existing L3 path and nothing below changes for it.
    */
    const preferRecording = Boolean(browserCanSayIt && picked.poor)
    if (preferRecording) {
      console.info(
        `[Gramini TTS] browser voice "${picked.voice.name}" is rough ` +
          `(quality=${picked.quality}) - trying the recorded audio first ` +
          'so every device sounds the same.',
      )
    }

    if (!browserCanSayIt || preferRecording) {
      /*
        Play recordings PARAGRAPH BY PARAGRAPH.

        The cache holds one clip per scheme; the backend puts each scheme in its
        own paragraph for exactly this reason. Looking up the whole answer only
        works for a single-scheme reply, and looking up a 220-character chunk
        never matches anything - so a nine-scheme answer would find no audio at
        all despite every scheme being recorded.

        Whatever is found is played in order. A paragraph with no recording is
        spoken by the browser when the browser can read it, and skipped when it
        cannot - either way the rest is not blocked, and the full text is on
        screen throughout.
      */
      const paragraphs = paragraphsOf(text)
      Promise.all(paragraphs.map((para) => findClip(para, speakLang)))
        .then((urls) => {
          if (queueId !== queueIdRef.current || done) return
          const found = urls.filter(Boolean)

          if (!found.length) {
            speakNext() // nothing recorded; fall through to chunks, then text
            return
          }

          console.info(
            `[Gramini TTS] fallbackLevel=3 (cached audio) ` +
              `${found.length}/${paragraphs.length} paragraph(s) recorded`,
          )
          setVoiceBlocked(false)

          /*
            Speak ONE paragraph with the browser voice, then carry on with the
            recordings. Chunked, because a paragraph can exceed the length a
            single utterance survives.
          */
          const speakGap = (paragraph, after) => {
            const pieces = chunkForSpeech(paragraph)
            let piece = 0
            const step = () => {
              if (queueId !== queueIdRef.current || done) return
              if (piece >= pieces.length) {
                after()
                return
              }
              const current = pieces[piece]
              piece += 1
              speakWithBrowser(current, step)
            }
            step()
          }

          let at = 0
          const playNext = () => {
            if (queueId !== queueIdRef.current || done) return
            if (at >= urls.length) {
              finish()
              return
            }
            const url = urls[at]
            const paragraph = paragraphs[at]
            at += 1
            if (!url) {
              /*
                No recording for this paragraph.

                When we came here for QUALITY the browser can still say it, and
                dropping it would lose content: a nine-scheme answer opens with
                "मुझे 9 सरकारी योजनाएँ मिलीं" and closes with an invitation to
                ask about one of them. Neither can ever be pre-recorded - their
                wording depends on how many schemes matched - so requiring a
                complete set would reject an answer whose nine schemes are all
                recorded. One voice change at each end beats two lost sentences.

                When we came here because NOTHING can read the script, the
                browser is not an option and skipping remains correct.
              */
              if (browserCanSayIt) {
                speakGap(paragraph, playNext)
                return
              }
              playNext() // not recorded - skip, the text is on screen
              return
            }
            playClip(url, {
              onReady: (cancel) => { cancelClipRef.current = cancel },
            }).then(() => {
              cancelClipRef.current = null
              setTimeout(playNext, 180)
            })
          }
          playNext()
        })
        .catch(() => speakNext())
      return
    }

    speakNext()
  }, [])
  useEffect(() => { speakRef.current = speak }, [speak])

  const stopSpeaking = useCallback(() => {
    // Bumping the queue id abandons any chunks still waiting. Without this,
    // cancel() silences the CURRENT utterance and the queue cheerfully starts
    // the next one - so pressing stop on a nine-scheme answer would not stop it.
    queueIdRef.current += 1
    // A recorded clip is an <audio> element, not part of speechSynthesis, so
    // cancel() alone would leave it playing after the user pressed stop.
    try {
      cancelClipRef.current?.()
    } catch {
      // ignore
    }
    cancelClipRef.current = null
    window.speechSynthesis?.cancel()
    busyRef.current = false
    spokenAtRef.current = Date.now()
    setState('idle')
  }, [])

  /*
    Keep the voice list warm and re-check availability whenever it changes.

    Two events matter and the old code waited for neither: Chrome populates the
    list a beat after load, and then adds Google's REMOTE voices when the network
    is up. Every Indian-language voice on a stock Windows machine comes from that
    second batch, so checking once on mount reports "no Marathi voice" on a
    machine that will have one a moment later.
  */
  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) {
      setVoiceAvailable(false)
      return
    }

    let cancelled = false
    const recheck = (voices) => {
      if (cancelled) return
      const list = voices?.length ? voices : currentVoices()
      if (!list.length) return // still loading; watchVoices will fire again
      setVoiceAvailable(hasNativeVoice(bcp47, list))
    }

    // Resolves as soon as the browser has anything, or after a short timeout.
    loadVoices().then(recheck)
    const stop = watchVoices(recheck)

    return () => {
      cancelled = true
      stop()
    }
  }, [bcp47])

  // Stop everything if the tab is hidden, so the phone does not talk in a pocket.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        stopListening()
        stopSpeaking()
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [stopListening, stopSpeaking])

  return {
    state,
    setState,
    interim,
    supported,
    voiceAvailable,
    voiceBlocked,
    micFailed,
    clearMicFailed: () => setMicFailed(false),
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isSpeaking: () => busyRef.current,
  }
}
