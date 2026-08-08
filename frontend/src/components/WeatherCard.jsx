import { useLang } from '../context/LanguageContext'
import { Badge } from './ui/Badge'

/**
 * The forecast, shown as numbers rather than only spoken.
 *
 * A farmer deciding whether to spray today wants the rain chance, and wants it
 * big. So temperature and rain probability are the two largest things on the
 * card, and everything else is secondary.
 *
 * The Live / Cached badge is not decoration. A cached forecast can be hours old,
 * and acting on stale rain data costs a day's work - so the card always says
 * which it is showing.
 */
const SKY_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌦️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}

function Stat({ label, value, unit }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-faint">
        {label}
      </span>
      <span className="text-lg font-bold text-ink">
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-muted">{unit}</span>}
      </span>
    </div>
  )
}

export function WeatherCard({ weather, cached, cacheAgeSeconds }) {
  const { t } = useLang()
  if (!weather) return null

  const icon = SKY_ICON[weather.code] ?? '🌤️'
  const rain = weather.rain_today
  const heavyRain = typeof rain === 'number' && rain >= 60

  const ageLabel =
    cached && typeof cacheAgeSeconds === 'number' && cacheAgeSeconds > 60
      ? `${Math.round(cacheAgeSeconds / 60)}m`
      : null

  return (
    <article className="overflow-hidden rounded-card border border-line bg-raised shadow-card">
      {/* Place and source */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-ink">{weather.place}</h3>
          {weather.admin && (
            <p className="truncate text-sm text-muted">{weather.admin}</p>
          )}
        </div>
        <Badge tone={cached ? 'warn' : 'ok'} icon={cached ? '💾' : '🟢'}>
          {cached ? `${t.weatherCached}${ageLabel ? ` · ${ageLabel}` : ''}` : t.weatherLive}
        </Badge>
      </header>

      {/* The two numbers that matter, large */}
      <div className="flex items-center gap-4 px-4 py-4">
        <span aria-hidden="true" className="text-5xl leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-4xl font-extrabold leading-none text-ink">
            {weather.temp_now}
            <span className="ml-1 text-2xl font-bold text-muted">°C</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {weather.today_min}° – {weather.today_max}°
          </p>
        </div>

        {typeof rain === 'number' && (
          <div
            className={[
              'shrink-0 rounded-xl2 px-3 py-2 text-center',
              heavyRain ? 'bg-saffron-soft' : 'bg-sunken',
            ].join(' ')}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">
              {t.weatherRain}
            </p>
            <p
              className={[
                'text-2xl font-extrabold leading-tight',
                heavyRain ? 'text-saffron-ink' : 'text-ink',
              ].join(' ')}
            >
              {rain}%
            </p>
          </div>
        )}
      </div>

      {/* Secondary numbers */}
      <div className="grid grid-cols-3 gap-3 border-t border-line px-4 py-3">
        <Stat label={t.weatherHumidity} value={weather.humidity} unit="%" />
        <Stat label={t.weatherTomorrow} value={weather.rain_tomorrow} unit="%" />
        <Stat label={t.weatherFeels} value={weather.today_max} unit="°" />
      </div>

      <footer className="border-t border-line bg-sunken px-4 py-2">
        <p className="text-xs text-faint">
          {t.weatherSource}: {weather.source || 'Open-Meteo'}
        </p>
      </footer>
    </article>
  )
}
