import { apiUrl } from './config'

/**
 * Is the PHONE offline, or is only OUR SERVER unreachable?
 *
 * The app used to treat "the backend did not answer" as "no internet". On
 * Render's free plan the backend sleeps after 15 idle minutes and takes
 * 30-60 seconds to wake, so every phone that opened the app after a quiet spell
 * was told its working Wi-Fi was broken - and the voice was switched to
 * offline-only, which on most phones means silence.
 *
 * The page itself is served by Vercel, a different host. If Vercel answers, the
 * internet works and the problem is the server; only when neither answers is
 * the phone genuinely offline.
 *
 * Statuses:
 *   'online'      backend answered
 *   'waking'      internet fine, backend did not answer in time (cold start)
 *   'server-down' internet fine, backend answered with an error
 *   'offline'     the phone cannot reach anything
 */

const BACKEND_TIMEOUT_MS = 10000
const SITE_TIMEOUT_MS = 5000

async function fetchWithTimeout(url, timeoutMs, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-store', ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Can the phone reach the internet at all? Asks the host that served this page.
 * navigator.onLine is not consulted: Windows reports false for some working
 * VPNs, and phones report true on Wi-Fi with no data.
 */
export async function internetReachable() {
  try {
    await fetchWithTimeout(`${window.location.origin}/?ping=${Date.now()}`, SITE_TIMEOUT_MS, {
      method: 'HEAD',
    })
    return true
  } catch {
    return false
  }
}

/** Ask the backend whether it is alive. Never touches Gemini. */
async function pingBackend() {
  let response = await fetchWithTimeout(apiUrl('/health'), BACKEND_TIMEOUT_MS)
  // A backend deployed before /health existed still has /api/health.
  if (response.status === 404) {
    response = await fetchWithTimeout(apiUrl('/api/health'), BACKEND_TIMEOUT_MS)
  }
  return response
}

export async function diagnose() {
  try {
    const response = await pingBackend()
    return response.ok ? 'online' : 'server-down'
  } catch {
    return (await internetReachable()) ? 'waking' : 'offline'
  }
}

/**
 * Why did a real request fail? 'offline' only when the phone itself has no
 * connection; everything else is a server-side problem and must say so.
 */
export async function classifyFailure(error) {
  if (error?.status) return 'server-down' // the server answered, with an error
  return (await internetReachable()) ? 'waking' : 'offline'
}
