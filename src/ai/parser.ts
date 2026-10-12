import type { z } from 'zod'
import { fmtTime } from '../lib/text'
import { GradeSchema, MaterialSchema, NewTestSchema, QuestionSchema, type Material, type NewTest, type Question, type Grade } from './schema'

/**
 * Robustný parser odpovede od Claude (vložený text z claude.ai alebo text z API):
 * odstráni markdown ohraničenie a text okolo, spojí viac častí, nájde JSON,
 * opraví bežné chyby (koncové čiarky, komentáre, neescapované nové riadky a LaTeX)
 * a zvaliduje schému.
 */

export type ParseResult<T> =
  | { ok: true; data: T; warnings: string[] }
  | { ok: false; errors: string[]; truncated?: boolean }

const FENCE = /```[a-zA-Z]*[ \t]*\r?\n?/

/** Odstráni text pred/za blokom kódu v jednej časti odpovede. */
export function stripFences(part: string): string {
  let s = part.replace(/\r\n/g, '\n')
  const open = s.search(FENCE)
  if (open >= 0) {
    const m = s.slice(open).match(FENCE)!
    s = s.slice(open + m[0].length)
    const close = s.lastIndexOf('```')
    if (close >= 0) s = s.slice(0, close)
  }
  return s
}

/**
 * Pokračovanie odpovede: ak má iba jedno ``` ohraničenie, rozhodne, či ide o otvárací
 * (pred ním je prázdno alebo len text) alebo uzatvárací blok (pred ním je JSON).
 */
function stripContinuation(part: string): string {
  const s = part.replace(/\r\n/g, '\n')
  const fences = [...s.matchAll(/```[a-zA-Z]*[ \t]*\n?/g)]
  if (fences.length === 0) return s
  if (fences.length >= 2) return stripFences(s)
  const f = fences[0]
  const before = s.slice(0, f.index)
  if (/["{}[\]]/.test(before)) return before // uzatvárací blok – JSON je pred ním
  return s.slice(f.index! + f[0].length) // otvárací blok – JSON pokračuje za ním
}

/** Spojí časti (pokračovania odpovede) do jedného textu. */
export function joinParts(parts: string[]): string {
  const cleaned = parts.filter((p) => p.trim())
  if (cleaned.length <= 1) return cleaned.length ? stripFences(cleaned[0].trim()) : ''
  // medzery na hranici častí nechávame (rez mohol byť uprostred vety), odstraňujeme len nové riadky
  return cleaned
    .map((p, i) => {
      const s = i === 0 ? stripFences(p.replace(/^\s+/, '')) : stripContinuation(p.replace(/\s+$/, ''))
      return i === 0 ? s.replace(/[\r\n]+$/, '') : s.replace(/^[\r\n]+|[\r\n]+$/g, '')
    })
    .join('')
}

/** Nájde prvý vyvážený JSON objekt. Vráti aj informáciu, či je odpoveď useknutá. */
export function extractJson(text: string): { json: string | null; truncated: boolean } {
  const start = text.indexOf('{')
  if (start < 0) return { json: null, truncated: false }
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return { json: text.slice(start, i + 1), truncated: false }
    }
  }
  return { json: text.slice(start), truncated: true }
}

// LaTeX príkazy začínajúce písmenom, ktoré je v JSON platnou escape sekvenciou (\b \f \n \r \t)
const LATEX_BFNRT =
  /^(beta|bar|bf|begin|big|Big|bigg|binom|bullet|boldsymbol|backslash|frac|forall|flat|fbox|nabla|neq|ne\b|ni\b|not|nu\b|newline|nolimits|rho|right|rangle|rm\b|rceil|rfloor|text|times|tau|theta|tan|tanh|tfrac|to\b|tilde|top|triangle|textbf|textit)/

/**
 * Opraví bežné chyby JSON-u od LLM: koncové čiarky, komentáre, nové riadky a tabulátory
 * v reťazcoch, neplatné escape sekvencie (typicky LaTeX: \sigma, \frac).
 */
export function repairJson(src: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') {
        const n = src[i + 1] ?? ''
        const rest = src.slice(i + 1, i + 12)
        if (n === '\\' || n === '"' || n === '/') {
          out += c + n
          i++
        } else if ('bfnrt'.includes(n) && n !== '' && LATEX_BFNRT.test(rest)) {
          out += '\\\\' // LaTeX príkaz – zdvojiť lomítko
        } else if ('bfnrt'.includes(n) && n !== '') {
          out += c + n
          i++
        } else if (n === 'u' && /^u[0-9a-fA-F]{4}/.test(rest)) {
          out += c
        } else {
          out += '\\\\' // neplatný escape (\sigma, \alpha, \underline …)
        }
      } else if (c === '"') {
        inStr = false
        out += c
      } else if (c === '\n') out += '\\n'
      else if (c === '\r') continue
      else if (c === '\t') out += '\\t'
      else if (c < ' ') out += ' '
      else out += c
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 1
    } else {
      out += c
    }
  }
  // koncové čiarky pred } alebo ]
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Riadiace znaky, ktoré vzniknú z neescapovaného LaTeX-u (\frac → form feed + "rac"). */
export function fixLatexControlChars(s: string): string {
  return s
    .replace(/\f(?=[a-zA-Z])/g, '\\f')
    .replace(new RegExp(String.fromCharCode(8) + '(?=[a-zA-Z])', 'g'), '\\b')
    .replace(/\t(?=(ext|imes|au\b|heta|an\b|frac|o\b|ilde|riangle))/g, '\\t')
    .replace(/\r(?=(ho\b|ight|angle|m\b))/g, '\\r')
    .replace(/\n(?=(abla|eq\b|u\b|ot\b|ewline))/g, '\\n')
}

function deepFixStrings<T>(v: T): T {
  if (typeof v === 'string') return fixLatexControlChars(v) as T
  if (Array.isArray(v)) return v.map(deepFixStrings) as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) o[k] = deepFixStrings(val)
    return o as T
  }
  return v
}

/** Zjednotí pole, ktoré má byť pole (null/undefined → [], objekt → [objekt]). */
function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v === undefined || v === null || v === '') return []
  return [v]
}

function casStr(v: unknown): unknown {
  if (typeof v === 'number' && Number.isFinite(v)) return fmtTime(v)
  if (typeof v === 'string') return v.trim().replace(/^\[|\]$/g, '')
  return v
}

function num(v: unknown): unknown {
  if (typeof v === 'string') {
    const n = Number(v.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : v
  }
  return v
}

function bool(v: unknown): unknown {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'pravda', 'ano', 'áno', 'yes', 'p'].includes(s)) return true
    if (['false', 'nepravda', 'nie', 'no', 'n'].includes(s)) return false
  }
  return v
}

const TYP_ALIASES: Record<string, Question['typ']> = {
  jedna: 'jedna', single: 'jedna', jednamoznost: 'jedna', abcd: 'jedna',
  viac: 'viac', multi: 'viac', multiple: 'viac', viacmoznosti: 'viac',
  pravdanepravda: 'pravdaNepravda', truefalse: 'pravdaNepravda', pn: 'pravdaNepravda', anonie: 'pravdaNepravda',
  doplnenie: 'doplnenie', doplnovacka: 'doplnenie', fill: 'doplnenie',
  otvorena: 'otvorena', open: 'otvorena',
  vypocet: 'vypocet', calc: 'vypocet', vypoctova: 'vypocet',
}

/** Zhovievavá normalizácia otázky pred validáciou. */
export function fixupQuestion(raw: unknown, i: number): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const q = { ...(raw as Record<string, unknown>) }
  if (typeof q.typ === 'string') {
    const key = q.typ.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '')
    q.typ = TYP_ALIASES[key] ?? q.typ
  }
  if (typeof q.id !== 'string' || !q.id) q.id = `q${i + 1}`
  if (typeof q.vysvetlenie !== 'string') q.vysvetlenie = ''
  if (typeof q.skuskova !== 'boolean') q.skuskova = bool(q.skuskova) === true
  q.obtiaznost = Math.min(3, Math.max(1, Math.round(Number(num(q.obtiaznost)) || 2)))
  const z = q.zdroj && typeof q.zdroj === 'object' ? { ...(q.zdroj as Record<string, unknown>) } : {}
  if (z.cas !== undefined) z.cas = casStr(z.cas)
  if (z.cas === '' || z.cas === null) delete z.cas
  if (z.citat === null) delete z.citat
  if (z.sekciaId === null) delete z.sekciaId
  q.zdroj = z
  switch (q.typ) {
    case 'jedna':
      q.spravne = num(q.spravne)
      break
    case 'viac':
      q.spravne = arr(q.spravne).map(num)
      break
    case 'pravdaNepravda':
      q.spravne = bool(q.spravne)
      delete q.moznosti
      break
    case 'doplnenie':
      q.spravne = arr(q.spravne).map((x) => String(x))
      delete q.moznosti
      break
    case 'otvorena':
      if (typeof q.vzorovaOdpoved !== 'string') q.vzorovaOdpoved = typeof q.spravne === 'string' ? q.spravne : ''
      q.kluceveBody = arr(q.kluceveBody).map((x) => String(x))
      delete q.spravne
      delete q.moznosti
      break
    case 'vypocet': {
      q.spravne = num(q.spravne)
      q.tolerancia = num(q.tolerancia)
      if (typeof q.tolerancia !== 'number' || !Number.isFinite(q.tolerancia)) {
        q.tolerancia = typeof q.spravne === 'number' ? Math.abs(q.spravne) * 0.02 : 0
      }
      q.tolerancia = Math.abs(q.tolerancia as number)
      if (typeof q.jednotka !== 'string') q.jednotka = ''
      delete q.moznosti
      break
    }
  }
  return q
}

/** Zhovievavá normalizácia materiálu pred validáciou. */
export function fixupMaterial(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const m = { ...(raw as Record<string, unknown>) }
  // niekedy model obalí výsledok do { "material": {...} }
  if (!('sekcie' in m) && m.material && typeof m.material === 'object') return fixupMaterial(m.material)
  if (typeof m.nazov !== 'string') m.nazov = 'Prednáška'
  if (typeof m.zhrnutie !== 'string') m.zhrnutie = ''
  m.naSkuske = arr(m.naSkuske).map((x, i) => {
    const o = { ...(x as Record<string, unknown>) }
    if (typeof o.id !== 'string' || !o.id) o.id = `n${i + 1}`
    o.cas = casStr(o.cas ?? '00:00')
    if (typeof o.citat !== 'string') o.citat = ''
    if (typeof o.vysvetlenie !== 'string') o.vysvetlenie = ''
    if (!['vyslovne', 'zdoraznene', 'oznacene'].includes(o.typ as string)) o.typ = 'zdoraznene'
    return o
  })
  m.organizacne = arr(m.organizacne).map((x) => {
    const o = { ...(x as Record<string, unknown>) }
    o.cas = casStr(o.cas ?? '00:00')
    if (typeof o.citat !== 'string') o.citat = ''
    if (o.datum === null || o.datum === '') delete o.datum
    return o
  })
  m.sekcie = arr(m.sekcie).map((x, i) => {
    const o = { ...(x as Record<string, unknown>) }
    if (typeof o.id !== 'string' || !o.id) o.id = `s${i + 1}`
    o.casOd = casStr(o.casOd ?? '00:00')
    o.casDo = casStr(o.casDo ?? o.casOd)
    if (typeof o.obsah !== 'string') o.obsah = ''
    o.zvyraznenia = arr(o.zvyraznenia).map((z) => {
      const zz = { ...(z as Record<string, unknown>) }
      if (zz.cas !== undefined) zz.cas = casStr(zz.cas)
      if (zz.cas === '' || zz.cas === null) delete zz.cas
      if (zz.citat === null || zz.citat === '') delete zz.citat
      return zz
    })
    return o
  })
  m.pojmy = arr(m.pojmy).map((x) => ({ ...(x as object), cas: casStr((x as Record<string, unknown>).cas ?? '00:00') }))
  m.vzorce = arr(m.vzorce).map((x) => {
    const o = { ...(x as Record<string, unknown>) }
    o.cas = casStr(o.cas ?? '00:00')
    if (typeof o.latex === 'string') o.latex = o.latex.trim().replace(/^\$+|\$+$/g, '')
    if (typeof o.veliciny !== 'string') o.veliciny = Array.isArray(o.veliciny) ? o.veliciny.join('; ') : ''
    if (typeof o.popis !== 'string') o.popis = ''
    return o
  })
  m.karticky = arr(m.karticky).map((x) => {
    const o = { ...(x as Record<string, unknown>) }
    if (typeof o.sekciaId !== 'string') o.sekciaId = ''
    if (typeof o.skuskova !== 'boolean') o.skuskova = bool(o.skuskova) === true
    return o
  })
  m.naOverenie = arr(m.naOverenie).map((x) =>
    typeof x === 'string' ? { text: x, cas: '00:00' } : { ...(x as object), cas: casStr((x as Record<string, unknown>).cas ?? '00:00') },
  )
  m.test = arr(m.test ?? m.otazky)
  delete m.otazky
  return m
}

const ISSUE_TEXT: Record<string, string> = {
  invalid_type: 'chýba alebo má nesprávny typ',
  too_small: 'je príliš krátke / má málo položiek',
  too_big: 'je príliš veľké / má priveľa položiek',
  invalid_value: 'má nepovolenú hodnotu',
  invalid_union: 'nezodpovedá žiadnemu povolenému tvaru',
  unrecognized_keys: 'obsahuje neznáme polia',
}

export function formatIssues(err: z.ZodError, prefix = ''): string[] {
  return err.issues.slice(0, 15).map((iss) => {
    const path = [prefix, ...iss.path.map(String)].filter(Boolean).join('.')
    return `Pole „${path || '(celý objekt)'}“ ${ISSUE_TEXT[iss.code] ?? 'je neplatné'} (${iss.message}).`
  })
}

/** Zvaliduje otázky jednotlivo – neplatné vyradí (s varovaním) namiesto zlyhania celého celku. */
export function validateQuestions(raw: unknown[], warnings: string[], label = 'test'): Question[] {
  const out: Question[] = []
  const ids = new Set<string>()
  raw.forEach((r, i) => {
    const res = QuestionSchema.safeParse(fixupQuestion(r, i))
    if (!res.success) {
      warnings.push(`Otázka č. ${i + 1} bola vyradená: ${formatIssues(res.error, `${label}.${i}`)[0]}`)
      return
    }
    const q = res.data
    // kontrola indexov voči možnostiam
    if (q.typ === 'jedna' && q.spravne >= q.moznosti.length) {
      warnings.push(`Otázka č. ${i + 1} bola vyradená: index správnej odpovede je mimo možností.`)
      return
    }
    if (q.typ === 'viac' && q.spravne.some((x) => x >= q.moznosti.length)) {
      warnings.push(`Otázka č. ${i + 1} bola vyradená: index správnej odpovede je mimo možností.`)
      return
    }
    if (ids.has(q.id)) q.id = `${q.id}_${i + 1}`
    ids.add(q.id)
    out.push(q)
  })
  return out
}

function parseJsonText(parts: string[]): { value: unknown } | { errors: string[]; truncated?: boolean } {
  const text = joinParts(parts)
  if (!text.trim()) return { errors: ['Vložená odpoveď je prázdna.'] }
  const { json, truncated } = extractJson(text)
  if (!json) return { errors: ['V odpovedi som nenašiel žiadny JSON (chýba znak „{“). Skopíroval si celú odpoveď od Claude?'] }
  if (truncated) {
    return {
      truncated: true,
      errors: [
        'Odpoveď je neúplná – JSON je useknutý. V Claude napíš „pokračuj“, skopíruj aj pokračovanie a pridaj ho ako ďalšiu časť.',
      ],
    }
  }
  try {
    return { value: deepFixStrings(JSON.parse(json)) }
  } catch {
    try {
      return { value: deepFixStrings(JSON.parse(repairJson(json))) }
    } catch (e) {
      return { errors: [`JSON sa nedá prečítať ani po automatickej oprave: ${(e as Error).message}`] }
    }
  }
}

export function validateMaterial(value: unknown): ParseResult<Material> {
  const warnings: string[] = []
  const fixed = fixupMaterial(value) as Record<string, unknown>
  const rawTest = Array.isArray(fixed?.test) ? (fixed.test as unknown[]) : []
  const res = MaterialSchema.safeParse({ ...fixed, test: [] })
  if (!res.success) return { ok: false, errors: formatIssues(res.error) }
  const data = res.data
  data.test = validateQuestions(rawTest, warnings)
  if (!data.sekcie.length) return { ok: false, errors: ['Materiál neobsahuje žiadne sekcie („sekcie“ je prázdne pole).'] }
  // jednoznačné id sekcií
  const seen = new Set<string>()
  data.sekcie.forEach((s, i) => {
    if (seen.has(s.id)) s.id = `${s.id}_${i + 1}`
    seen.add(s.id)
  })
  return { ok: true, data, warnings }
}

export function parseMaterialResponse(parts: string[]): ParseResult<Material> {
  const r = parseJsonText(parts)
  if ('errors' in r) return { ok: false, errors: r.errors, truncated: r.truncated }
  return validateMaterial(r.value)
}

export function validateNewTest(value: unknown): ParseResult<NewTest> {
  const warnings: string[] = []
  const v = value as Record<string, unknown>
  const raw = Array.isArray(value) ? value : arr(v?.otazky ?? v?.test ?? v?.questions)
  const otazky = validateQuestions(raw, warnings, 'otazky')
  if (!otazky.length) return { ok: false, errors: ['Odpoveď neobsahuje žiadnu platnú otázku.', ...warnings.slice(0, 5)] }
  const res = NewTestSchema.safeParse({ otazky })
  if (!res.success) return { ok: false, errors: formatIssues(res.error) }
  return { ok: true, data: res.data, warnings }
}

export function parseNewTestResponse(parts: string[]): ParseResult<NewTest> {
  const r = parseJsonText(parts)
  if ('errors' in r) return { ok: false, errors: r.errors, truncated: r.truncated }
  return validateNewTest(r.value)
}

export function validateGrade(value: unknown): ParseResult<Grade> {
  const v = { ...(value as Record<string, unknown>) }
  v.skore = num(v.skore)
  v.chybajuce = arr(v.chybajuce)
  const res = GradeSchema.safeParse(v)
  if (!res.success) return { ok: false, errors: formatIssues(res.error) }
  return { ok: true, data: res.data, warnings: [] }
}

export function parseGradeResponse(parts: string[]): ParseResult<Grade> {
  const r = parseJsonText(parts)
  if ('errors' in r) return { ok: false, errors: r.errors, truncated: r.truncated }
  return validateGrade(r.value)
}
