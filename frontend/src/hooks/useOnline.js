import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/config'

const PING_MS = 8000
const PING_TIMEOUT_MS = 4000

/**
 * Whether the app can actually reach its backend.
 *
 * navigator.onLine only says a network interface exists, not that packets get
 * anywhere - which is exactly the village case: full bars, no data. So this also
 * listens for real request failures reported by the API layer.
 *
 * It then RE-CHECKS on a timer, which the first version did not. Without that, a
 * single failed request pinned the app to "offline" forever: the banner stayed
 * up long after the network came back, because nothing ever asked again. A
 * recovering connection is the normal case this app is built for, so noticing
 * the recovery matters as much as noticing the loss.
 */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false)

  useEffect(() => {
    let cancelled = false
    let timer = null

    const ping = async () => {
      // Deliberately does NOT consult navigator.onLine.
      //
      // That flag is a guess about the operating system's network adapter, and
      // on Windows it reports false for VPNs, captive portals and half-woken
      // adapters while everything actually works. An earlier version returned
      // early on it, which pinned the app to "offline" with a perfectly healthy
      // backend and no way to recover.
      //
      // What this app needs to know is narrower and answerable: can it reach its
      // own API? Asking is cheap and always correct, so it always asks.
      const controller = new AbortController()
      const abort = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
      try {
        const response = await fetch(apiUrl('/api/health'), {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!cancelled) setOnline(response.ok)
      } catch {
        if (!cancelled) setOnline(false)
      } finally {
        clearTimeout(abort)
      }
    }

    ping()
    timer = setInterval(ping, PING_MS)

    // OS-level events are treated as a nudge to re-check, never as the answer.
    const up = () => ping()
    const down = () => ping()
    /**
     * A real request reported its outcome.
     *
     * Success is trusted at once - it is proof. Failure is only a suspicion, so
     * it triggers an immediate re-check instead: one slow or aborted request
     * (a long translation, a turn that timed out) should not flash "no
     * internet" at a user whose connection is fine.
     */
    const observed = (event) => {
      if (event.detail?.reachable) setOnline(true)
      else ping()
    }
    const onFocus = () => ping()

    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    window.addEventListener('gramini:reachability', observed)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.removeEventListener('gramini:reachability', observed)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return online
}
