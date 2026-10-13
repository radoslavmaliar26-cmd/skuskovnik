import { normalize, words } from '../lib/text'
import type { RawPart } from './provider'

/**
 * Filtrovanie typických halucinácií Whisperu:
 * - segmenty s vysokým no_speech_prob a nízkym avg_logprob,
 * - vety, ktoré Whisper „vymýšľa“ v tichu (titulky, poďakovania),
 * - zacyklené opakovania tej istej vety.
 */

// typické „titulkové“ vety z ticha – odstraňujú sa len ako samostatné krátke vety
const ALWAYS = [
  /titulky (vytvoril|vytvorila|vytvorili|pripravil|zpracoval|preklad)/,
  /^titulky\b/,
  /\bamara\.org\b/,
  /^(subtitles|captions) by\b/,
  /^(odoberajte|odebirejte|sledujte nas)\b/,
  /^thanks? for watching\b/,
  /^dakujeme za (pozretie|sledovanie)\b/,
  /^dekujeme za zhlednuti\b/,
]

// halucinácia len v tichu (inak to môže reálne zaznieť)
const IN_SILENCE = [
  /^(dakujem|dekuji|dakujeme|dekujeme)( vam)?( pekne| moc)?( za pozornost)?[.!]?$/,
  /^(dovidenia|na zhledanou|na shledanou|ahoj)[.!]?$/,
  /^(hm+|mhm|ehm|aha)[.!]?$/,
  /^\.+$/,
  /^♪+$/,
]

function isAlways(t: string) {
  const n = normalize(t).trim()
  return ALWAYS.some((r) => r.test(n))
}

/**
 * Odstráni z textu krátke vety typu „Titulky vytvoril…“ (max. ~12 slov).
 * Zvyšok ponechá – dlhý úsek reči sa kvôli jednej vete nikdy nezahodí.
 */
export function stripCreditSentences(text: string): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g)
  if (!sentences) return text
  return sentences
    .filter((s) => !(words(s).length <= 12 && isAlways(s)))
    .join('')
    .trim()
}

function isSilencePhrase(t: string) {
  const n = normalize(t)
    .replace(/[^a-z0-9 .!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return IN_SILENCE.some((r) => r.test(n))
}

/** Odstráni zacyklené opakovania viet v rámci textu (ponechá prvý výskyt). */
export function collapseRepeats(text: string): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g)
  if (!sentences) return text
  const out: string[] = []
  let prev = ''
  let repeats = 0
  for (const s of sentences) {
    const key = words(s).join(' ')
    if (key && key === prev) {
      repeats++
      if (repeats >= 1) continue // rovnaká veta hneď za sebou → preskoč
    } else {
      repeats = 0
    }
    prev = key
    out.push(s)
  }
  // opakovanie krátkej frázy v jednej vete („a potom a potom a potom …“)
  return out
    .join('')
    .replace(/\b((?:\S+\s+){1,4}?\S+)(?:\s+\1\b){3,}/gi, '$1')
    .trim()
}

export function filterHallucinations(parts: RawPart[], opts: { timed: boolean }): RawPart[] {
  const out: RawPart[] = []
  let prevKey = ''
  let sameCount = 0
  const singleShort = parts.length === 1 && words(parts[0]?.text ?? '').length <= 4
  for (const p of parts) {
    let text = p.text.trim()
    if (!text) continue
    // metadáta Whisperu: pravdepodobne ticho
    if (p.noSpeechProb !== undefined && p.avgLogprob !== undefined && p.noSpeechProb > 0.6 && p.avgLogprob < -1) continue
    if (p.compressionRatio !== undefined && p.compressionRatio > 2.6) {
      text = collapseRepeats(text)
    }
    text = stripCreditSentences(text)
    if (!text) continue
    if (isSilencePhrase(text)) {
      const silentByMeta = p.noSpeechProb !== undefined && p.noSpeechProb > 0.3
      const lowConfidence = p.avgLogprob !== undefined && p.avgLogprob < -0.8
      if (silentByMeta || lowConfidence || (!opts.timed && singleShort)) continue
    }
    text = collapseRepeats(text)
    const key = words(text).join(' ')
    if (key && key === prevKey) {
      sameCount++
      if (sameCount >= 1) continue // rovnaký segment ako predchádzajúci → zacyklenie
    } else {
      sameCount = 0
    }
    prevKey = key
    out.push({ ...p, text })
  }
  return out
}
