import type { Question } from '../ai/schema'
import type { Answer, QuestionResult } from '../db/types'
import { normalize } from '../lib/text'

/** Normalizácia textovej odpovede: bez diakritiky, veľkosti písmen, interpunkcie na okrajoch a viacnásobných medzier. */
export function normAnswer(s: string): string {
  return normalize(s)
    .replace(/[„“"'‚‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.,;:!?()–]+|[.,;:!?()\-–]+$/g, '')
    .trim()
}

/** Číslo z textu („0,95 mm“, „1 200“, „4.76e-4“, „−3“) → number | null. */
export function parseNumber(s: string): number | null {
  const cleaned = s
    .replace(/[−–]/g, '-')
    .replace(/(\d)[\s ](?=\d{3}\b)/g, '$1')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[·×]\s*10\^?\s*(-?\d+)/g, 'e$1')
  const m = cleaned.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

export function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (a === undefined || a === null) return false
  switch (q.typ) {
    case 'jedna':
      return typeof a === 'number'
    case 'viac':
      return Array.isArray(a) && a.length > 0
    case 'pravdaNepravda':
      return typeof a === 'boolean'
    case 'doplnenie':
    case 'vypocet':
      return typeof a === 'string' && a.trim().length > 0
    case 'otvorena':
      return true
  }
}

const SELF: Record<NonNullable<QuestionResult['selfGrade']>, number> = { vedel: 1, ciastocne: 0.5, nevedel: 0 }

/** Vyhodnotí odpoveď. Pri otvorenej otázke rozhoduje samohodnotenie (alebo AI skóre). */
export function scoreQuestion(q: Question, a: Answer | undefined, extra: { selfGrade?: QuestionResult['selfGrade']; aiScore?: number } = {}): QuestionResult {
  switch (q.typ) {
    case 'jedna': {
      const ok = a === q.spravne
      return { score: ok ? 1 : 0, correct: ok }
    }
    case 'viac': {
      const sel = new Set(Array.isArray(a) ? a : [])
      const right = new Set(q.spravne)
      let hit = 0
      let wrong = 0
      sel.forEach((x) => (right.has(x) ? hit++ : wrong++))
      const exact = hit === right.size && wrong === 0
      const partial = Math.max(0, (hit - wrong) / right.size)
      return { score: exact ? 1 : Math.round(partial * 100) / 100, correct: exact }
    }
    case 'pravdaNepravda': {
      const ok = a === q.spravne
      return { score: ok ? 1 : 0, correct: ok }
    }
    case 'doplnenie': {
      const given = typeof a === 'string' ? normAnswer(a) : ''
      if (!given) return { score: 0, correct: false }
      const gn = parseNumber(given)
      const ok = q.spravne.some((s) => {
        const exp = normAnswer(s)
        if (exp === given) return true
        const en = parseNumber(exp)
        return en !== null && gn !== null && /^[-\d.,\s]+$/.test(exp) && Math.abs(en - gn) < 1e-9
      })
      return { score: ok ? 1 : 0, correct: ok }
    }
    case 'vypocet': {
      const n = typeof a === 'string' ? parseNumber(a) : null
      if (n === null) return { score: 0, correct: false }
      const tol = Math.max(q.tolerancia, Math.abs(q.spravne) * 1e-9)
      const ok = Math.abs(n - q.spravne) <= tol + 1e-12
      return { score: ok ? 1 : 0, correct: ok }
    }
    case 'otvorena': {
      if (extra.aiScore !== undefined && extra.selfGrade === undefined) {
        const s = Math.max(0, Math.min(1, extra.aiScore))
        return { score: s, correct: s >= 0.75 }
      }
      const s = extra.selfGrade ? SELF[extra.selfGrade] : 0
      return { score: s, correct: s === 1, selfGrade: extra.selfGrade }
    }
  }
}

/** Text správnej odpovede (na zobrazenie). */
export function correctAnswerText(q: Question): string {
  switch (q.typ) {
    case 'jedna':
      return q.moznosti[q.spravne] ?? ''
    case 'viac':
      return q.spravne.map((i) => q.moznosti[i]).join('; ')
    case 'pravdaNepravda':
      return q.spravne ? 'Pravda' : 'Nepravda'
    case 'doplnenie':
      return q.spravne.join(' / ')
    case 'vypocet':
      return `${String(q.spravne).replace('.', ',')}${q.jednotka ? ' ' + q.jednotka : ''} (tolerancia ±${String(q.tolerancia).replace('.', ',')})`
    case 'otvorena':
      return q.vzorovaOdpoved
  }
}

/** Text odpovede používateľa (na zobrazenie). */
export function answerText(q: Question, a: Answer | undefined): string {
  if (a === undefined || a === null || a === '') return '(bez odpovede)'
  switch (q.typ) {
    case 'jedna':
      return typeof a === 'number' ? (q.moznosti[a] ?? '') : ''
    case 'viac':
      return Array.isArray(a) ? a.map((i) => q.moznosti[i]).join('; ') : ''
    case 'pravdaNepravda':
      return a === true ? 'Pravda' : 'Nepravda'
    default:
      return String(a)
  }
}

export function summarize(questions: Question[], results: Record<string, QuestionResult>) {
  let score = 0
  let examScore = 0
  let examMax = 0
  for (const q of questions) {
    const r = results[q.id]
    score += r?.score ?? 0
    if (q.skuskova) {
      examMax++
      examScore += r?.score ?? 0
    }
  }
  return { score: Math.round(score * 100) / 100, max: questions.length, examScore: Math.round(examScore * 100) / 100, examMax }
}
