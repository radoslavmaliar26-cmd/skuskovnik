import type { Paragraph } from '../db/types'
import { fmtTime, normalize, parseTime, words } from '../lib/text'
import type { Material } from './schema'

/** Index slov prepisu s odhadnutým časom každého slova. */
export interface TranscriptIndex {
  words: string[]
  times: number[]
  flat: string
}

export function buildIndex(paragraphs: Paragraph[], totalSec?: number): TranscriptIndex {
  const ws: string[] = []
  const ts: number[] = []
  paragraphs.forEach((p, i) => {
    const pw = words(p.text)
    const next = paragraphs[i + 1]?.t ?? (totalSec && totalSec > p.t ? totalSec : p.t + pw.length / 2.5)
    const span = Math.max(0, next - p.t)
    pw.forEach((w, j) => {
      ws.push(w)
      ts.push(p.t + (pw.length ? (j / pw.length) * span : 0))
    })
  })
  return { words: ws, times: ts, flat: ' ' + ws.join(' ') + ' ' }
}

export interface QuoteMatch {
  found: boolean
  /** 0..1 – podiel slov citátu nájdených v najlepšom okne */
  score: number
  t: number | null
}

/**
 * Tolerantné vyhľadanie citátu v prepise: bez diakritiky, ≥ threshold zhoda slov v okne
 * rovnakej dĺžky ako citát (+ malá rezerva na vynechané slová).
 */
export function findQuote(index: TranscriptIndex, quote: string, threshold = 0.8): QuoteMatch {
  const q = words(quote)
  if (!q.length || !index.words.length) return { found: false, score: 0, t: null }
  if (q.length <= 3) {
    const needle = ' ' + q.join(' ') + ' '
    const pos = index.flat.indexOf(needle)
    if (pos < 0) return { found: false, score: 0, t: null }
    const wordIdx = index.flat.slice(0, pos + 1).split(' ').filter(Boolean).length
    return { found: true, score: 1, t: index.times[Math.min(wordIdx, index.times.length - 1)] ?? null }
  }
  const need = new Map<string, number>()
  for (const w of q) need.set(w, (need.get(w) ?? 0) + 1)
  const win = Math.min(index.words.length, q.length + Math.ceil(q.length * 0.15))
  const have = new Map<string, number>()
  let matches = 0
  const add = (w: string) => {
    const h = (have.get(w) ?? 0) + 1
    have.set(w, h)
    if (h <= (need.get(w) ?? 0)) matches++
  }
  const remove = (w: string) => {
    const h = have.get(w) ?? 0
    if (h <= (need.get(w) ?? 0) && h > 0) matches--
    have.set(w, h - 1)
  }
  let best = -1
  let bestStart = 0
  for (let i = 0; i < index.words.length; i++) {
    add(index.words[i])
    if (i >= win) remove(index.words[i - win])
    if (matches > best) {
      best = matches
      bestStart = Math.max(0, i - win + 1)
    }
  }
  const score = best / q.length
  // presnejší začiatok: prvé slovo v okne, ktoré je v citáte
  let start = bestStart
  for (let k = bestStart; k < Math.min(index.words.length, bestStart + win); k++) {
    if (need.has(index.words[k])) {
      start = k
      break
    }
  }
  return { found: score >= threshold, score, t: score >= threshold ? index.times[start] : null }
}

function check(index: TranscriptIndex, item: { citat?: string; cas?: string; overene?: boolean }) {
  if (!item.citat || !item.citat.trim()) {
    item.overene = false
    return
  }
  const m = findQuote(index, item.citat)
  item.overene = m.found
  if (m.found && m.t !== null && (item.cas === undefined || parseTime(item.cas) === null)) {
    item.cas = fmtTime(m.t)
  }
}

/** Overí všetky citáty v materiáli (mutuje a vráti ho) a vráti počty. */
export function verifyMaterial(material: Material, paragraphs: Paragraph[], totalSec?: number) {
  const index = buildIndex(paragraphs, totalSec)
  let total = 0
  let ok = 0
  const run = (item: { citat?: string; cas?: string; overene?: boolean }) => {
    check(index, item)
    if (item.citat) {
      total++
      if (item.overene) ok++
    }
  }
  material.naSkuske.forEach(run)
  material.organizacne.forEach(run)
  material.sekcie.forEach((s) => s.zvyraznenia.forEach(run))
  material.test.forEach((q) => run(q.zdroj))
  return { material, total, ok }
}

/** Overí citáty v zozname otázok (napr. nový test). */
export function verifyQuestions<T extends { zdroj: { citat?: string; cas?: string; overene?: boolean } }>(
  qs: T[],
  paragraphs: Paragraph[],
) {
  const index = buildIndex(paragraphs)
  qs.forEach((q) => check(index, q.zdroj))
  return qs
}

export { normalize }
