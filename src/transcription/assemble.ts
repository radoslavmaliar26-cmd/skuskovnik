import type { Paragraph, Segment, TranscriptPart } from '../db/types'
import { fmtTime, parseTime } from '../lib/text'

/** Rýchlosť reči na odhad časov pri vloženom texte bez časových značiek (slová/s). */
const WORDS_PER_SEC = 2.3

/**
 * Prevedie vložený text na odseky. Ak odseky začínajú časom [mm:ss], použije ho;
 * inak čas odhadne podľa počtu slov.
 */
export function parsePastedTranscript(text: string): Paragraph[] {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|\n(?=\s*\[?\d{1,3}:\d{2}(?::\d{2})?\]?\s)/)
    .map((b) => b.trim())
    .filter(Boolean)
  const out: Paragraph[] = []
  let estimate = 0
  for (const b of blocks) {
    const m = b.match(/^\[?(\d{1,3}:\d{2}(?::\d{2})?)\]?\s+([\s\S]*)$/)
    const body = (m ? m[2] : b).replace(/\s*\n\s*/g, ' ').trim()
    if (!body) continue
    const t = m ? (parseTime(m[1]) ?? estimate) : estimate
    out.push({ t, text: body })
    estimate = t + body.split(/\s+/).length / WORDS_PER_SEC
  }
  // dlhý text bez odsekov rozdeľ na menšie odseky (~120 slov)
  if (out.length === 1 && out[0].text.split(/\s+/).length > 200) {
    return splitLong(out[0].text, out[0].t)
  }
  return out
}

function splitLong(text: string, t0: number): Paragraph[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]
  const out: Paragraph[] = []
  let cur = ''
  let t = t0
  for (const s of sentences) {
    cur += s
    if (cur.split(/\s+/).length >= 120) {
      out.push({ t: Math.round(t), text: cur.trim() })
      t += cur.split(/\s+/).length / WORDS_PER_SEC
      cur = ''
    }
  }
  if (cur.trim()) out.push({ t: Math.round(t), text: cur.trim() })
  return out
}

/**
 * Zloží odseky z prepísaných segmentov. Časti kratšie ako ~minLen sa spájajú do odsekov
 * (cca 40–60 s), aby mal prepis prehľadné [mm:ss] značky.
 */
export function paragraphsFromSegments(segments: Segment[], maxParagraphSec = 50): Paragraph[] {
  const parts: TranscriptPart[] = []
  const sorted = [...segments].sort((a, b) => a.index - b.index)
  for (const s of sorted) {
    if (s.status !== 'done' || !s.parts) continue
    for (const p of s.parts) if (p.text.trim()) parts.push(p)
  }
  const out: Paragraph[] = []
  let cur: Paragraph | null = null
  for (const p of parts) {
    const text = p.text.trim()
    const elapsed = cur ? p.start - cur.t : 0
    const sentenceEnded = cur ? /[.!?…]$/.test(cur.text) : true
    if (!cur || (elapsed >= maxParagraphSec && sentenceEnded) || elapsed >= maxParagraphSec * 2) {
      if (cur) out.push(cur)
      cur = { t: Math.round(p.start), text }
    } else {
      cur.text += ' ' + text
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Text prepisu s [mm:ss] na začiatku odsekov (pre AI aj export). */
export function transcriptToText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => `[${fmtTime(p.t)}] ${p.text}`).join('\n\n')
}
