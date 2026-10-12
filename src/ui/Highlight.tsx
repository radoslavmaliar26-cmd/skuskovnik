import type { ReactNode } from 'react'

export interface Range {
  start: number
  end: number
  cls: string
  title?: string
}

/** Vykreslí text so zvýraznenými úsekmi (prekrývajúce sa úseky sa ignorujú). */
export function highlight(text: string, ranges: Range[]): ReactNode[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const out: ReactNode[] = []
  let pos = 0
  let k = 0
  for (const r of sorted) {
    if (r.start < pos) continue
    if (r.start > pos) out.push(text.slice(pos, r.start))
    out.push(
      <mark key={k++} className={`hl ${r.cls}`} title={r.title}>
        {text.slice(r.start, r.end)}
      </mark>,
    )
    pos = r.end
  }
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

/** Nájde výskyty hľadaného výrazu (bez diakritiky a veľkosti písmen). */
export function searchRanges(text: string, query: string): Range[] {
  const q = query.trim()
  if (q.length < 2) return []
  const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  // NFD môže zmeniť dĺžku – mapujeme po znakoch
  const map: number[] = []
  let norm = ''
  for (let i = 0; i < text.length; i++) {
    const n = strip(text[i])
    for (let j = 0; j < n.length; j++) map.push(i)
    norm += n
  }
  const nq = strip(q)
  const out: Range[] = []
  let idx = norm.indexOf(nq)
  while (idx >= 0) {
    const start = map[idx]
    const end = (map[idx + nq.length - 1] ?? text.length - 1) + 1
    out.push({ start, end, cls: 'search' })
    idx = norm.indexOf(nq, idx + nq.length)
  }
  return out
}
