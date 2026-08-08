/**
 * Playing back speech the backend recorded earlier.
 *
 * Level 3 of the voice fallback ladder. The clips are plain WAV files served
 * from /audio/, so once a clip has been played it sits in the browser's HTTP
 * cache and keeps working with no network at all.
 *
 * The manifest maps "this exact sentence in this language" to a filename. It is
 * fetched while online and kept in localStorage, because looking up what exists
 * must not itself require a request.
 */

import { apiUrl } from './config'

const MANIFEST_KEY = 'gramini.audioManifest'

let manifest = null

/** Same key the backend computes: sha1 of "lang|normalised text", first 16. */
async function keyFor(text, lang) {
  const normalised = String(text || '').trim().replace(/\s+/g, ' ')
  const bytes = new TextEncoder().encode(`${lang}|${normalised}`)
  const digest = await crypto.subtle.digest('SHA-1', bytes)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${lang}-${hex.slice(0, 16)}`
}

function readStored() {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Load the manifest: cache first so this works offline, then refresh. */
export async function loadManifest() {
  if (!manifest) manifest = readStored() || {}

  try {
    const response = await fetch(apiUrl('/api/audio-manifest'), { cache: 'no-store' })
    if (response.ok) {
      const data = await response.json()
      if (data?.clips) {
        manifest = data.clips
        try {
          localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
        } catch {
          // storage full; the in-memory copy still works this session
        }
      }
    }
  } catch {
    // Offline. The stored manifest is exactly what we need right now.
  }
  return manifest
}

export function manifestSize() {
  return Object.keys(manifest || readStored() || {}).length
}

/**
 * Numbering the app adds when it lists several schemes: "योजना 3. ", "Scheme 3. ".
 *
 * The cache holds one clip per scheme, recorded from the scheme's own sentence.
 * A multi-scheme answer prepends this label, so an exact lookup misses every
 * time and all eight recordings would sit unused. Stripping it is what makes the
 * cache work for the answer users actually ask for - "सरकारी योजना बताओ".
 */
const LIST_PREFIX = /^\s*(?:योजना|Scheme|योजना क्रमांक)\s*\d+\s*[.।:-]\s*/i

/** The URL of a recording for this sentence, or null. */
export async function findClip(text, lang) {
  if (!text) return null
  if (!manifest) manifest = readStored() || {}
  if (!Object.keys(manifest).length) return null

  // Try the text as given, then with a list label removed.
  const attempts = [String(text)]
  const stripped = String(text).replace(LIST_PREFIX, '')
  if (stripped !== String(text)) attempts.push(stripped)

  for (const attempt of attempts) {
    let key
    try {
      key = await keyFor(attempt, lang)
    } catch {
      return null // crypto.subtle needs a secure context; fall through the ladder
    }
    const file = manifest[key]
    if (file) return apiUrl(`/audio/${file}`)
  }
  return null
}

/**
 * Split an answer the way the CACHE is organised: one piece per scheme.
 *
 * The backend separates schemes with a blank line for exactly this reason. The
 * speech queue chunks at 220 characters, which never lines up with a recording,
 * so the cached path needs its own split.
 */
export function paragraphsOf(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/**
 * Play one clip. Resolves true when it finished, false if it could not play.
 *
 * `onStop` is handed a canceller so the caller can interrupt playback the same
 * way it interrupts speech synthesis.
 */
export function playClip(url, { onReady } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    const audio = new Audio(url)
    audio.onended = () => done(true)
    audio.onerror = () => done(false)
    onReady?.(() => {
      try {
        audio.pause()
      } catch {
        // ignore
      }
      done(false)
    })

    audio.play().catch(() => done(false))

    // A clip that never fires ended (decoder stall) must not wedge the queue.
    setTimeout(() => done(false), 120000)
  })
}
