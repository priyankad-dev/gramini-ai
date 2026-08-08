/**
 * Splitting a long answer into utterances the browser will actually finish.
 *
 * `speechSynthesis.speak()` looks like it accepts any length of text. It does
 * not, reliably:
 *
 *  - Chrome stops speaking after roughly 15 seconds of a single utterance and
 *    fires neither `onend` nor `onerror`. The voice simply stops mid-sentence
 *    and the queue is left wedged.
 *  - Several engines silently truncate long strings.
 *  - A cancelled long utterance can leave the synthesiser in a state where the
 *    next `speak()` never starts.
 *
 * A nine-scheme answer is about 1,800 characters, or two minutes of audio, so
 * every one of those applies. The answer is therefore cut into chunks and spoken
 * one at a time, each waiting for the previous to end.
 *
 * Chunks are cut at sentence boundaries, never mid-sentence, and never inside a
 * scheme: the backend separates schemes with a blank line precisely so the split
 * can happen there first.
 */

// Comfortably under the point where engines start truncating, and short enough
// that any single chunk finishes well inside Chrome's ~15s ceiling.
const MAX_CHUNK = 220

// Sentence ends in Latin AND Devanagari (danda), plus the Urdu full stop.
const SENTENCE_END = /(?<=[.!?।॥۔])\s+/

/** Break one paragraph into pieces no longer than `max`, at sentence ends. */
function splitParagraph(text, max) {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= max) return [trimmed]

  const sentences = trimmed.split(SENTENCE_END).filter(Boolean)
  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    // A single sentence longer than the limit still has to be broken up, or it
    // would be the one chunk that gets cut off. Commas are the least bad place.
    if (sentence.length > max) {
      if (current) {
        chunks.push(current.trim())
        current = ''
      }
      let rest = sentence
      while (rest.length > max) {
        const window = rest.slice(0, max)
        const cut = Math.max(
          window.lastIndexOf(', '),
          window.lastIndexOf('। '),
          window.lastIndexOf(' - '),
          window.lastIndexOf(' '),
        )
        const at = cut > max * 0.5 ? cut + 1 : max
        chunks.push(rest.slice(0, at).trim())
        rest = rest.slice(at)
      }
      if (rest.trim()) current = rest.trim()
      continue
    }

    if ((current + ' ' + sentence).trim().length > max) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/**
 * Turn an answer into an ordered list of utterances.
 *
 * Paragraphs come first, because the backend puts each scheme in its own
 * paragraph - so "Scheme 3" always starts a fresh utterance rather than being
 * glued onto the tail of scheme 2.
 */
export function chunkForSpeech(text, max = MAX_CHUNK) {
  if (!text) return []
  const paragraphs = String(text).split(/\n{2,}/)
  const chunks = []
  for (const paragraph of paragraphs) {
    chunks.push(...splitParagraph(paragraph, max))
  }
  return chunks.filter((c) => c && c.trim().length > 0)
}

export { MAX_CHUNK }
