/**
 * The phone's approximate location, for "what is the weather here?".
 *
 * Asked for only when the server says it needs it (REQUEST_LOCATION), never on
 * page load. Rounded to two decimals (~1 km) before it leaves the phone: a
 * forecast does not need a farmer's exact house, and the coordinates go only
 * to the weather lookup - never to the language model.
 *
 * A refusal is remembered, so the app asks once and then asks for a city
 * instead of nagging with a prompt the user already said no to.
 */

const DENIED_KEY = 'gramini.locationDenied'

function rememberDenied(value) {
  try {
    if (value) localStorage.setItem(DENIED_KEY, '1')
    else localStorage.removeItem(DENIED_KEY)
  } catch {
    // Storage blocked: we may ask again next session, which is acceptable.
  }
}

function deniedBefore() {
  try {
    return localStorage.getItem(DENIED_KEY) === '1'
  } catch {
    return false
  }
}

/** 'granted' | 'prompt' | 'denied' | 'unknown' - without triggering a prompt. */
export async function locationPermission() {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' })
    if (status?.state) return status.state
  } catch {
    // Safari before 16 cannot query geolocation.
  }
  return deniedBefore() ? 'denied' : 'unknown'
}

/**
 * Resolves to { lat, lon } or { error } where error is
 * 'denied' | 'unavailable' | 'timeout' | 'unsupported'. Never throws.
 */
export async function getApproxLocation() {
  if (!navigator.geolocation || !window.isSecureContext) return { error: 'unsupported' }

  const permission = await locationPermission()
  // Said no before and has not changed it in settings: do not ask again.
  if (permission === 'denied' || (permission !== 'granted' && deniedBefore())) {
    return { error: 'denied' }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        rememberDenied(false)
        resolve({
          lat: Math.round(position.coords.latitude * 100) / 100,
          lon: Math.round(position.coords.longitude * 100) / 100,
        })
      },
      (error) => {
        console.warn('[location] failed:', error?.code, error?.message)
        if (error?.code === 1) {
          rememberDenied(true)
          resolve({ error: 'denied' })
        } else {
          resolve({ error: error?.code === 3 ? 'timeout' : 'unavailable' })
        }
      },
      // Coarse and cached is enough for a forecast, and far faster on a phone
      // than waiting for a GPS fix.
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

/** Quick client-side guess, only to pick the loading text. The server decides. */
const WEATHER_HINT =
  /मौसम|बारिश|बरसात|तापमान|हवामान|पाऊस|छिड़काव|फवारणी|सिंचाई|weather|rain|temperature|forecast|humidity|spray|pesticide|irrigat|mausam|baarish|barish|tapman|havaman/i

export function looksLikeWeather(text) {
  return WEATHER_HINT.test(text || '')
}
