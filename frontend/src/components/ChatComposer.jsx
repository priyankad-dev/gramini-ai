import { useState } from 'react'
import { useLang } from '../context/LanguageContext'

/**
 * The typed fallback.
 *
 * The whole app is built on the finding that villagers speak rather than type,
 * so this is deliberately not the default. It exists because voice-only fails a
 * real set of people: someone in a noisy hall, someone whose accent the browser
 * keeps mishearing, someone who cannot speak at all. Designing for low literacy
 * must not become a refusal to accept text from those who do want to type.
 *
 * Reached by SAYING "let me type", or by the button next to the mic.
 */
export function ChatComposer({ onSend, onVoiceMode, disabled }) {
  const { t } = useLang()
  const [text, setText] = useState('')

  const submit = (event) => {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    setText('')
    onSend(trimmed)
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <button
        type="button"
        onClick={onVoiceMode}
        title={t.voiceMode}
        aria-label={t.voiceMode}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line text-2xl text-muted transition-colors hover:bg-hover"
      >
        <span aria-hidden="true">🎙️</span>
      </button>

      <label className="sr-only" htmlFor="gramini-chat-input">
        {t.typeHere}
      </label>
      <textarea
        id="gramini-chat-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) submit(event)
        }}
        rows={1}
        placeholder={t.typeHere}
        disabled={disabled}
        className="min-h-[56px] flex-1 resize-none rounded-2xl border border-line bg-sunken px-4 py-4 text-base text-ink placeholder:text-faint focus:border-ink focus:outline-none disabled:opacity-60"
      />

      <button
        type="submit"
        disabled={disabled || !text.trim()}
        title={t.send}
        aria-label={t.send}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-saffron text-xl text-onbrand transition-opacity disabled:opacity-40"
      >
        <span aria-hidden="true">↑</span>
      </button>
    </form>
  )
}
