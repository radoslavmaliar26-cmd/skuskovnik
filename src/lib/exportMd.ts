import type { Material, Question } from '../ai/schema'
import type { Lecture } from '../db/types'
import { fmtDate } from './text'

/** Prevedie materiál na Markdown (na zdieľanie / export). */
export function materialToMarkdown(m: Material, lecture: Lecture, subjectName?: string): string {
  const L: string[] = []
  L.push(`# ${m.nazov}`)
  L.push(`*${subjectName ? subjectName + ' · ' : ''}${lecture.title} · ${fmtDate(lecture.createdAt)}*`, '')
  L.push(m.zhrnutie, '')
  L.push('## 🔴 Bude na skúške', '')
  if (!m.naSkuske.length) L.push('_(nič výslovne)_', '')
  for (const n of m.naSkuske) {
    const tag = !n.overene ? '⚪ NEOVERENÉ' : n.typ === 'vyslovne' ? '🔴 NA SKÚŠKE' : n.typ === 'oznacene' ? '⭐ OZNAČIL SI' : '🟠 DÔLEŽITÉ'
    L.push(`- **${n.tema}** (${tag}, ${n.cas}) – ${n.vysvetlenie}`, `  > „${n.citat}“`)
  }
  L.push('')
  if (m.organizacne.length) {
    L.push('## 📅 Organizačné', '')
    for (const o of m.organizacne) L.push(`- ${o.datum ? `**${o.datum}** – ` : ''}${o.text} (${o.cas})`)
    L.push('')
  }
  for (const s of m.sekcie) {
    L.push(`## ${s.nadpis} (${s.casOd}–${s.casDo})`, '', s.obsah, '')
    for (const z of s.zvyraznenia) {
      const label = { skuska: '🔴 NA SKÚŠKE', dolezite: '🟠 DÔLEŽITÉ', pozor: '🟠 POZOR', definicia: '🔵 DEFINÍCIA', vzorec: '🔵 VZOREC', priklad: '🔵 PRÍKLAD' }[z.typ]
      L.push(`> **${z.typ === 'skuska' && !z.overene ? '⚪ NEOVERENÉ' : label}:** ${z.text}${z.cas ? ` (${z.cas})` : ''}`, '')
    }
  }
  if (m.vzorce.length) {
    L.push('## Vzorce', '')
    for (const v of m.vzorce) L.push(`- **${v.popis}:** $${v.latex}$ – ${v.veliciny}`)
    L.push('')
  }
  if (m.pojmy.length) {
    L.push('## Pojmy', '')
    for (const p of m.pojmy) L.push(`- **${p.pojem}** – ${p.definicia}`)
    L.push('')
  }
  if (m.naOverenie.length) {
    L.push('## Na overenie', '')
    for (const n of m.naOverenie) L.push(`- ${n.text} (${n.cas})`)
    L.push('')
  }
  return L.join('\n')
}

export function questionsToMarkdown(qs: Question[]): string {
  return qs
    .map((q, i) => {
      const lines = [`${i + 1}. ${q.otazka}`]
      if ('moznosti' in q) q.moznosti.forEach((o, j) => lines.push(`   ${String.fromCharCode(97 + j)}) ${o}`))
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Zdieľanie súboru cez Web Share API; inak stiahnutie. */
export async function shareOrDownload(filename: string, text: string, mime = 'text/markdown') {
  const file = new File([text], filename, { type: mime })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  try {
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename })
      return 'shared'
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled'
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}

export function safeFilename(s: string) {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'skuskovnik'
  )
}
