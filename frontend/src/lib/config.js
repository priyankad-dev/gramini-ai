/**
 * Where the backend lives.
 *
 * In development this is empty, so every request stays a relative path and
 * Vite's dev proxy forwards it to 127.0.0.1:8000 — exactly as before, with no
 * behaviour change.
 *
 * In production the frontend and backend are on different hosts (Vercel and
 * Render), there is no proxy, and a relative `/api/...` would hit the static
 * site and return index.html. `VITE_API_BASE_URL` supplies the backend origin
 * at build time.
 *
 * This file contains no secrets and never will. Anything in a `VITE_` variable
 * is compiled into the JavaScript bundle and is readable by anyone — which is
 * precisely why the Gemini key lives only in the BACKEND environment.
 */
const RAW = import.meta.env?.VITE_API_BASE_URL ?? ''

/** Trailing slashes would produce `//api/health`, which some hosts 404. */
export const API_BASE = String(RAW).replace(/\/+$/, '')

/** Build a full URL for a backend path. Works in both environments. */
export function apiUrl(path) {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${clean}`
}

export const IS_PRODUCTION = Boolean(API_BASE)
