import type { Material } from './schema'

/** Spojí materiály z viacerých častí prednášky do jedného (id sa prečíslujú, aby boli jedinečné). */
export function mergeMaterials(parts: Material[], title?: string): Material {
  if (parts.length === 1) return parts[0]
  const out: Material = {
    nazov: title ?? parts[0].nazov,
    zhrnutie: parts.map((p) => p.zhrnutie.trim()).filter(Boolean).join(' '),
    naSkuske: [],
    organizacne: [],
    sekcie: [],
    pojmy: [],
    vzorce: [],
    karticky: [],
    naOverenie: [],
    test: [],
  }
  const seenPojmy = new Set<string>()
  const seenVzorce = new Set<string>()
  parts.forEach((p, k) => {
    const pre = `c${k + 1}-`
    const secMap = new Map<string, string>()
    p.sekcie.forEach((s) => {
      secMap.set(s.id, pre + s.id)
      out.sekcie.push({ ...s, id: pre + s.id })
    })
    const sid = (id?: string) => (id ? (secMap.get(id) ?? id) : id)
    out.naSkuske.push(...p.naSkuske.map((n) => ({ ...n, id: pre + n.id })))
    out.organizacne.push(...p.organizacne)
    for (const x of p.pojmy) {
      const key = x.pojem.trim().toLowerCase()
      if (!seenPojmy.has(key)) {
        seenPojmy.add(key)
        out.pojmy.push(x)
      }
    }
    for (const v of p.vzorce) {
      const key = v.latex.replace(/\s+/g, '')
      if (!seenVzorce.has(key)) {
        seenVzorce.add(key)
        out.vzorce.push(v)
      }
    }
    out.karticky.push(...p.karticky.map((c) => ({ ...c, sekciaId: sid(c.sekciaId) ?? '' })))
    out.naOverenie.push(...p.naOverenie)
    out.test.push(...p.test.map((q) => ({ ...q, id: pre + q.id, zdroj: { ...q.zdroj, sekciaId: sid(q.zdroj.sekciaId) } })))
  })
  return out
}
