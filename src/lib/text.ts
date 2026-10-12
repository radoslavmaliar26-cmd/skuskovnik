/** Odstráni diakritiku a zmení na malé písmená. */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function normalize(s: string): string {
  return stripDiacritics(s).toLowerCase()
}

/** Normalizované slová (bez diakritiky, interpunkcie). */
export function words(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** 125 → "02:05"; 4520 → "75:20" (minúty nie sú obmedzené na 59). */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** "mm:ss" | "h:mm:ss" | číslo → sekundy; inak null. */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v)
  if (typeof v !== 'string') return null
  const m = v.trim().replace(/^\[|\]$/g, '').match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return null
  if (m[3] !== undefined) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return Number(m[1]) * 60 + Number(m[2])
}

/** Slovenský dátum: 12. 10. 2026 */
export function fmtDate(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
}

/** 24-hodinový čas: 9:05 */
export function fmtClock(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtClock(ts)}`
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} kB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Slovenské skloňovanie podľa čísla: plural(3, 'otázka', 'otázky', 'otázok') */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * Rozdelí text na vety (zachová interpunkciu). Koniec vety je [.!?…] nasledovaný medzerou
 * a veľkým písmenom (prípadne úvodzovkou), koncom textu alebo novým riadkom – takže dátumy
 * „12. 11. 2026“ a čísla „3.5“ vetu nerozdelia.
 */
export function splitSentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = []
  const boundary = /[.!?…]+["“”'»)]*(?=\s+["„“'«(]?\p{Lu}|\s*$)|\n+/gu
  let last = 0
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to)
    const trimmed = raw.trim()
    if (trimmed) out.push({ text: trimmed, start: from + raw.indexOf(trimmed) })
  }
  let m: RegExpExecArray | null
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length
    push(last, end)
    last = end
    if (m[0].length === 0) boundary.lastIndex++
  }
  push(last, text.length)
  return out
}
