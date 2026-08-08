import { useLang } from '../context/LanguageContext'
import { Badge } from './ui/Badge'

/**
 * A scheme answer, with its source attached.
 *
 * Every fact here came out of backend/data/schemes.json, which a human checked
 * against the government portal. The model wrote none of it.
 *
 * The two things a user actually ACTS on - the official website and the
 * helpline - are full-width buttons at the bottom rather than links buried in
 * prose, because a phone number that has to be copied by hand is a phone number
 * that never gets called.
 *
 * The verified badge reflects backend data_status and is never hard-coded:
 * claiming "verified" over unchecked money advice is the one mistake this
 * project must not make.
 */
function Row({ label, children }) {
  return (
    <div className="border-t border-line px-4 py-3">
      <dt className="text-xs font-bold uppercase tracking-wide text-faint">
        {label}
      </dt>
      <dd className="mt-1 text-base leading-relaxed text-ink">{children}</dd>
    </div>
  )
}

export function SchemeCard({ scheme, others, onPickOther, onRepeat, dataStatus }) {
  const { t } = useLang()
  if (!scheme) return null

  const verified = scheme.verified_on || dataStatus === 'verified'
  const tel = scheme.helpline ? scheme.helpline.replace(/[^0-9]/g, '') : null

  return (
    <article className="overflow-hidden rounded-card border border-line bg-raised shadow-card">
      {/* Identity: emblem, name, and how trustworthy the data is */}
      <header className="flex items-start gap-3 bg-leaf-soft px-4 py-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-xl shadow-card"
        >
          {scheme.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-snug text-leaf-ink">
            {scheme.name}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={verified ? 'ok' : 'warn'} icon={verified ? '✅' : '🔎'}>
              {verified ? t.verified : t.unverified}
            </Badge>
            {scheme.machine_translated && (
              <Badge tone="neutral" icon="🔤">
                {t.machineTranslatedGroup?.split('—')[0]?.trim() || 'Auto'}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <dl>
        <Row label={t.whatYouGet}>{scheme.what_you_get}</Row>
        <Row label={t.whoCanApply}>{scheme.who_can_apply}</Row>
        <Row label={t.papersNeeded}>
          <ul className="flex flex-wrap gap-1.5">
            {(scheme.papers_needed || []).map((paper) => (
              <li
                key={paper}
                className="rounded-lg border border-line bg-sunken px-2.5 py-1 text-sm font-medium text-muted"
              >
                {paper}
              </li>
            ))}
          </ul>
        </Row>
        <Row label={t.howToApply}>{scheme.how_to_apply}</Row>
      </dl>

      {/* The two actions, made unmissable. */}
      <div className="flex flex-col gap-2 border-t border-line bg-sunken px-4 py-3">
        <a
          href={scheme.official_link}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-tap items-center justify-center gap-2 rounded-xl2 bg-leaf px-4 py-3 text-base font-bold text-onbrand transition-opacity hover:opacity-90"
        >
          <span aria-hidden="true">🔗</span> {t.openWebsite}
        </a>

        {tel && (
          <a
            href={`tel:${tel}`}
            className="flex min-h-tap items-center justify-center gap-2 rounded-xl2 border-2 border-leaf px-4 py-3 text-base font-bold text-leaf-ink transition-colors hover:bg-leaf-soft"
          >
            <span aria-hidden="true">☎️</span> {t.callHelpline} · {scheme.helpline}
          </a>
        )}

        {/* The URL stays visible: the citation is part of the answer, not a
            footnote, and it is spoken aloud too. */}
        <p className="break-all text-center text-xs text-faint">
          {scheme.official_link}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onRepeat}
          className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-hover"
        >
          🔁 {t.repeat}
        </button>

        {others?.length > 0 && (
          <>
            <span className="text-sm text-faint">{t.alsoSee}</span>
            {others.map((other) => (
              <button
                key={other.id}
                type="button"
                onClick={() => onPickOther(other.id)}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-hover"
              >
                <span aria-hidden="true">{other.icon}</span>
                {other.name}
              </button>
            ))}
          </>
        )}
      </div>
    </article>
  )
}
