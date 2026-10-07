import { useEffect, useRef, useState } from 'react'
import { diagnose } from '../lib/connection'

const PING_MS = 8000

/**
 * Can the phone reach the internet, and can it reach OUR server?
 *
 * Two questions, kept apart. The first version asked only "did /api/health
 * answer within 4 seconds?" and called a no "offline". A sleeping Render
 * backend takes far longer than that to wake, so phones on perfectly good Wi-Fi
 * were shown "No internet" and had their voice cut to offline-only.
 *
 * Returns:
 *   status  'online' | 'waking' | 'server-down' | 'offline' (see lib/connection)
 *   online  true unless the PHONE itself is offline - this is what decides
 *           whether internet-only things (Google's voices) can work
 *
 * It re-checks on a timer, on focus and whenever a real request reports
 * trouble, so a recovering connection or a server that has woken up is noticed
 * without a reload.
 */
export function useConnection() {
  const [status, setStatus] = useState('online')
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      // A cold start keeps a ping open for up to 10s; never stack them.
      if (inFlight.current) return
      inFlight.current = true
      try {
        const next = await diagnose()
        if (!cancelled) setStatus(next)
      } finally {
        inFlight.current = false
      }
    }

    check()
    const timer = setInterval(check, PING_MS)

    // OS-level events are treated as a nudge to re-check, never as the answer.
    const nudge = () => check()
    /**
     * A real request reported its outcome. Success is proof and is trusted at
     * once; failure is only a suspicion and triggers a re-check.
     */
    const observed = (event) => {
      if (event.detail?.reachable) setStatus('online')
      else check()
    }

    window.addEventListener('online', nudge)
    window.addEventListener('offline', nudge)
    window.addEventListener('focus', nudge)
    window.addEventListener('gramini:reachability', observed)

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('online', nudge)
      window.removeEventListener('offline', nudge)
      window.removeEventListener('focus', nudge)
      window.removeEventListener('gramini:reachability', observed)
    }
  }, [])

  return { status, online: status !== 'offline' }
}
