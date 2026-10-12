import { z } from 'zod'

/**
 * Jediná definícia schémy materiálu a testu. Z nej sa odvodzujú:
 * TypeScript typy, validácia (zod), popis JSON schémy do promptu (režim A)
 * aj input_schema nástroja pre Anthropic API (režim B).
 */

const cas = z.string().describe('Čas v prednáške vo formáte mm:ss (napr. "07:45"; minúty môžu byť aj > 59)')
const citat = z.string().describe('Presný citát z prepisu (doslovne, aj s chybami prepisu)')
/** Dopĺňa appka po overení citátu – AI ho nevypĺňa (z promptu sa odstraňuje). */
const overene = z.boolean().optional()

export const ZdrojSchema = z
  .object({
    sekciaId: z.string().optional().describe('id sekcie materiálu'),
    cas: cas.optional(),
    citat: citat.optional(),
    overene,
  })
  .describe('Odkiaľ v prednáške je odpoveď')

const qBase = {
  id: z.string().describe('Unikátne id otázky, napr. "q1"'),
  otazka: z.string(),
  vysvetlenie: z.string().describe('Prečo je správna odpoveď správna (z prednášky)'),
  zdroj: ZdrojSchema,
  skuskova: z.boolean().describe('true, ak sa otázka týka témy, ktorá bude na skúške'),
  obtiaznost: z.number().int().min(1).max(3).describe('1 = ľahká, 2 = stredná, 3 = ťažká'),
}

export const QuestionSchema = z.discriminatedUnion('typ', [
  z.object({
    ...qBase,
    typ: z.literal('jedna').describe('Jedna správna možnosť'),
    moznosti: z.array(z.string()).min(2).max(6),
    spravne: z.number().int().min(0).describe('Index správnej možnosti (od 0)'),
  }),
  z.object({
    ...qBase,
    typ: z.literal('viac').describe('Viac správnych možností'),
    moznosti: z.array(z.string()).min(2).max(8),
    spravne: z.array(z.number().int().min(0)).min(1).describe('Indexy všetkých správnych možností (od 0)'),
  }),
  z.object({
    ...qBase,
    typ: z.literal('pravdaNepravda'),
    spravne: z.boolean(),
  }),
  z.object({
    ...qBase,
    typ: z.literal('doplnenie').describe('Doplň chýbajúce slovo/výraz (v otázke označ miesto ako ___)'),
    spravne: z.array(z.string()).min(1).describe('Všetky prijateľné odpovede'),
  }),
  z.object({
    ...qBase,
    typ: z.literal('otvorena'),
    vzorovaOdpoved: z.string(),
    kluceveBody: z.array(z.string()).describe('Body, ktoré má dobrá odpoveď obsahovať'),
  }),
  z.object({
    ...qBase,
    typ: z.literal('vypocet'),
    spravne: z.number().describe('Správny číselný výsledok'),
    tolerancia: z.number().min(0).describe('Povolená absolútna odchýlka výsledku'),
    jednotka: z.string().describe('Jednotka výsledku, napr. "MPa" (prázdne, ak bez jednotky)'),
    vzorovaOdpoved: z.string().optional().describe('Postup výpočtu'),
  }),
])

export type Question = z.infer<typeof QuestionSchema>
export type QuestionType = Question['typ']

export const NaSkuskeSchema = z.object({
  id: z.string(),
  tema: z.string(),
  vysvetlenie: z.string().describe('Čo presne treba vedieť'),
  citat,
  cas,
  typ: z
    .enum(['vyslovne', 'zdoraznene', 'oznacene'])
    .describe('vyslovne = vyučujúci povedal, že to bude na skúške; zdoraznene = silné zdôraznenie; oznacene = označil študent ⭐/🎯'),
  overene,
})

export const ZvyraznenieSchema = z.object({
  typ: z.enum(['skuska', 'dolezite', 'definicia', 'vzorec', 'priklad', 'pozor']),
  text: z.string(),
  citat: citat.optional(),
  cas: cas.optional(),
  overene,
})

export const SekciaSchema = z.object({
  id: z.string().describe('Krátke id, napr. "s1"'),
  nadpis: z.string(),
  casOd: cas,
  casDo: cas,
  obsah: z.string().describe('Výklad v Markdown, vzorce v LaTeX ($...$, $$...$$)'),
  zvyraznenia: z.array(ZvyraznenieSchema),
})

export const MaterialSchema = z.object({
  nazov: z.string(),
  zhrnutie: z.string().describe('Zhrnutie prednášky v 3–6 vetách'),
  naSkuske: z.array(NaSkuskeSchema).describe('Všetko, čo bude na skúške (najdôležitejšia časť)'),
  organizacne: z.array(
    z.object({
      text: z.string(),
      datum: z.string().optional().describe('Dátum vo formáte D. M. RRRR, ak bol uvedený'),
      citat,
      cas,
      overene,
    }),
  ),
  sekcie: z.array(SekciaSchema),
  pojmy: z.array(z.object({ pojem: z.string(), definicia: z.string(), cas })),
  vzorce: z.array(
    z.object({
      latex: z.string().describe('Vzorec v LaTeX bez ohraničenia $'),
      popis: z.string(),
      veliciny: z.string().describe('Význam veličín a ich jednotky'),
      cas,
    }),
  ),
  karticky: z.array(
    z.object({ otazka: z.string(), odpoved: z.string(), sekciaId: z.string(), skuskova: z.boolean() }),
  ),
  naOverenie: z.array(z.object({ text: z.string(), cas })).describe('Miesta, kde prepis nedáva zmysel'),
  test: z.array(QuestionSchema).describe('10–15 úvodných testových otázok'),
})

export type Material = z.infer<typeof MaterialSchema>
export type NaSkuske = z.infer<typeof NaSkuskeSchema>
export type Sekcia = z.infer<typeof SekciaSchema>
export type Zvyraznenie = z.infer<typeof ZvyraznenieSchema>

export const NewTestSchema = z.object({ otazky: z.array(QuestionSchema) })
export type NewTest = z.infer<typeof NewTestSchema>

export const GradeSchema = z.object({
  skore: z.number().min(0).max(1).describe('0 = nevedel, 0.5 = čiastočne, 1 = vedel'),
  hodnotenie: z.string().describe('Krátka spätná väzba po slovensky (1–3 vety)'),
  chybajuce: z.array(z.string()).describe('Kľúčové body, ktoré v odpovedi chýbajú'),
})
export type Grade = z.infer<typeof GradeSchema>

/** Odstráni interné polia (overene) z JSON schémy pre AI. */
function stripInternal(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripInternal)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$schema') continue
      if (k === 'properties' && v && typeof v === 'object') {
        const props: Record<string, unknown> = {}
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          if (pk !== 'overene') props[pk] = stripInternal(pv)
        }
        out[k] = props
      } else if (k === 'required' && Array.isArray(v)) {
        out[k] = v.filter((x) => x !== 'overene')
      } else {
        out[k] = stripInternal(v)
      }
    }
    return out
  }
  return node
}

export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  return stripInternal(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  jedna: 'Jedna správna',
  viac: 'Viac správnych',
  pravdaNepravda: 'Pravda / nepravda',
  doplnenie: 'Doplňovačka',
  otvorena: 'Otvorená',
  vypocet: 'Výpočet',
}
