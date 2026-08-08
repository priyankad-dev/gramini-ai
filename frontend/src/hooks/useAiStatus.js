import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/config'

/**
 * Whether the AI half of the backend is currently answering.
 *
 * Separate from useOnline, which asks a narrower question: can we reach our own
 * API at all. Both can disagree, and the difference matters to the user - a
 * spent Gemini quota looks exactly like a dead network from the outside, but
 * scheme lookup, weather and the language switch keep working through it. The
 * status chip needs to say which of the two is happening.
 *
 * Polled slowly: this changes on the scale of minutes, not seconds.
 */
const POLL_MS = 30000

export function useAiStatus() {
  const [status, setStatus] = useState({ aiReady: null, dataStatus: null })

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const data = await response.json()
        if (cancelled) return
        setStatus({
          aiReady: Boolean(data?.gemini?.available) && !data?.gemini?.last_error,
          dataStatus: data?.data_status ?? null,
        })
      } catch {
        if (!cancelled) setStatus((prev) => ({ ...prev, aiReady: null }))
      }
    }

    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return status
}
