import { useEffect, useState } from 'react'
import { currentVoices } from '../lib/voices'
import { apiUrl } from '../lib/config'

/**
 * What is actually working, right now, service by service.
 *
 * The app already degrades when a service fails; this is what lets the USER see
 * which one. That matters on stage: "the AI is out of quota but schemes still
 * work" is a completely different story from "the app is broken", and without a
 * per-service readout both look identical.
 *
 * Every check is cheap and non-blocking. Nothing here can throw into render.
 */
const POLL_MS = 15000

const OK = 'ok'        // 🟢 working
const CACHED = 'cached' // 🟡 degraded but usable
const DOWN = 'down'     // 🔴 unavailable

export function useServiceHealth(online) {
  const [health, setHealth] = useState({
    internet: OK,
    gemini: OK,
    weather: OK,
    speechIn: OK,
    speechOut: OK,
    camera: OK,
  })

  useEffect(() => {
    let cancelled = false

    // Browser capabilities: synchronous, no network needed.
    const speechIn =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)
        ? OK
        : DOWN
    const speechOut =
      typeof window !== 'undefined' && window.speechSynthesis
        ? currentVoices().length
          ? OK
          : CACHED
        : DOWN
    const camera = navigator?.mediaDevices?.getUserMedia ? OK : DOWN

    const check = async () => {
      let gemini = DOWN
      let weather = DOWN
      let internet = online ? OK : DOWN

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)
        const response = await fetch(apiUrl('/api/health'), {
          signal: controller.signal,
          cache: 'no-store',
        })
        clearTimeout(timer)
        if (response.ok) {
          const data = await response.json()
          internet = OK
          const g = data?.gemini
          gemini = g?.available && !g?.last_error ? OK : g?.available ? CACHED : DOWN
          // Weather is "cached" rather than down whenever clips exist on disk:
          // the app can still answer, just not with a live forecast.
          weather = data?.weather_cache?.entries > 0 ? (online ? OK : CACHED) : (online ? OK : DOWN)
        }
      } catch {
        // Backend unreachable. Everything server-side is down, but the cached
        // scheme pack and recorded audio in the browser still work. The
        // INTERNET chip is left to `online`: a sleeping server is not the
        // phone's connection, and calling it that sent users to fix their Wi-Fi.
        gemini = DOWN
        weather = CACHED
      }

      if (!cancelled) {
        setHealth({ internet, gemini, weather, speechIn, speechOut, camera })
      }
    }

    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [online])

  return health
}

export { OK, CACHED, DOWN }
