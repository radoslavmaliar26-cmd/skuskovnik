import { describe, expect, it } from 'vitest'
import { DEMO_MATERIAL } from '../demo/demoMaterial'
import { DEMO_TRANSCRIPT } from '../demo/demoTranscript'
import { parsePastedTranscript } from '../transcription/assemble'
import { extractJson, joinParts, parseMaterialResponse, parseNewTestResponse, repairJson, validateMaterial } from './parser'
import { MaterialSchema, jsonSchemaFor } from './schema'
import { verifyMaterial } from './verify'

const json = JSON.stringify(DEMO_MATERIAL, null, 2)

describe('parser vloženej odpovede', () => {
  it('prečíta čistý JSON', () => {
    const r = parseMaterialResponse([json])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.sekcie).toHaveLength(DEMO_MATERIAL.sekcie.length)
      expect(r.data.test).toHaveLength(DEMO_MATERIAL.test.length)
    }
  })

  it('odstráni markdown blok a text okolo', () => {
    const r = parseMaterialResponse([`Tu je materiál:\n\n\`\`\`json\n${json}\n\`\`\`\n\nDúfam, že pomôže!`])
    expect(r.ok).toBe(true)
  })

  it('spojí odpoveď rozdelenú do dvoch správ', () => {
    const cut = Math.floor(json.length / 2)
    const p1 = '```json\n' + json.slice(0, cut)
    const p2 = json.slice(cut) + '\n```'
    expect(parseMaterialResponse([p1]).ok).toBe(false)
    const r1 = parseMaterialResponse([p1])
    expect(!r1.ok && r1.truncated).toBe(true)
    expect(parseMaterialResponse([p1, p2]).ok).toBe(true)
    // pokračovanie v novom bloku kódu
    expect(parseMaterialResponse([p1, '```json\n' + json.slice(cut) + '\n```']).ok).toBe(true)
  })

  it('opraví koncové čiarky, komentáre a nové riadky v reťazcoch', () => {
    const broken = '{"a": [1, 2, 3,], // komentár\n "b": "riadok1\nriadok2",}'
    expect(JSON.parse(repairJson(broken))).toEqual({ a: [1, 2, 3], b: 'riadok1\nriadok2' })
  })

  it('opraví neescapovaný LaTeX', () => {
    const broken = '{"latex": "\\sigma = \\frac{N}{A}", "t": "\\tau a \\text{MPa}", "n": "riadok\\nďalší"}'
    const v = JSON.parse(repairJson(broken))
    expect(v.latex).toBe('\\sigma = \\frac{N}{A}')
    expect(v.t).toBe('\\tau a \\text{MPa}')
    expect(v.n).toBe('riadok\nďalší')
  })

  it('opraví LaTeX aj v platnom JSON (\\frac → form feed)', () => {
    const m = structuredClone(DEMO_MATERIAL)
    m.vzorce[0].latex = '\f' + 'rac{N}{A}'
    const r = parseMaterialResponse([JSON.stringify(m)])
    expect(r.ok && r.data.vzorce[0].latex).toBe('\\frac{N}{A}')
  })

  it('poškodený materiál vráti zrozumiteľnú chybu', () => {
    const r = parseMaterialResponse(['{"nazov": "x", "sekcie": [{"nadpis": 5}]}'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/sekcie/)
  })

  it('bez JSON', () => {
    const r = parseMaterialResponse(['Prepáč, nemôžem pomôcť.'])
    expect(r.ok).toBe(false)
  })

  it('zhovievavo opraví typy (čas ako číslo, typ otázky, čísla ako text)', () => {
    const m = JSON.parse(json)
    m.naSkuske[0].cas = 460
    m.test[0].typ = 'Jedna'
    m.test[0].spravne = '1'
    m.test[2].spravne = '100,0'
    delete m.pojmy
    const r = validateMaterial(m)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.naSkuske[0].cas).toBe('07:40')
      expect(r.data.test[0]).toMatchObject({ typ: 'jedna', spravne: 1 })
      expect(r.data.test[2]).toMatchObject({ spravne: 100 })
      expect(r.data.pojmy).toEqual([])
    }
  })

  it('vyradí neplatnú otázku s varovaním', () => {
    const m = JSON.parse(json)
    m.test[0].spravne = 9 // mimo možností
    const r = validateMaterial(m)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.test).toHaveLength(DEMO_MATERIAL.test.length - 1)
      expect(r.warnings.length).toBe(1)
    }
  })

  it('nový test', () => {
    const r = parseNewTestResponse(['```json\n' + JSON.stringify({ otazky: DEMO_MATERIAL.test.slice(0, 3) }) + '\n```'])
    expect(r.ok && r.data.otazky.length).toBe(3)
  })

  it('joinParts a extractJson', () => {
    expect(joinParts(['```json\n{"a":', '1}\n```'])).toBe('{"a":1}')
    expect(extractJson('text {"a": "}"} koniec').json).toBe('{"a": "}"}')
  })
})

describe('schéma a demo', () => {
  it('demo materiál je platný podľa schémy', () => {
    expect(MaterialSchema.safeParse(DEMO_MATERIAL).success).toBe(true)
  })

  it('všetky citáty v demo materiáli sa dajú overiť v demo prepise', () => {
    const paragraphs = parsePastedTranscript(DEMO_TRANSCRIPT)
    const m = structuredClone(DEMO_MATERIAL)
    const { total, ok } = verifyMaterial(m, paragraphs)
    const failed = [
      ...m.naSkuske.filter((x) => !x.overene).map((x) => x.citat),
      ...m.organizacne.filter((x) => !x.overene).map((x) => x.citat),
      ...m.sekcie.flatMap((s) => s.zvyraznenia.filter((z) => z.citat && !z.overene).map((z) => z.citat)),
      ...m.test.filter((q) => q.zdroj.citat && !q.zdroj.overene).map((q) => q.zdroj.citat),
    ]
    expect(failed).toEqual([])
    expect(ok).toBe(total)
  })

  it('JSON schéma pre AI neobsahuje interné pole „overene“', () => {
    const s = JSON.stringify(jsonSchemaFor(MaterialSchema))
    expect(s).not.toMatch(/overene/)
    expect(s).toMatch(/naSkuske/)
  })
})

describe('parser – kód v materiáli', () => {
  it('``` vo vnútri JSON reťazca (bez vonkajšieho bloku) nerozbije parsovanie', () => {
    const m = structuredClone(DEMO_MATERIAL)
    m.sekcie[0].obsah = 'Príklad:\n```python\nprint(1)\n```\nkoniec'
    const r = parseMaterialResponse([JSON.stringify(m)])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.sekcie[0].obsah).toContain('```python')
  })
})
