import type { Mark, Paragraph } from '../db/types'
import { findCues } from '../exam/examCues'
import { fmtTime } from '../lib/text'
import { transcriptToText } from '../transcription/assemble'
import { GradeSchema, jsonSchemaFor, MaterialSchema, NewTestSchema, type Material, type Question, type QuestionType } from './schema'

/** Pravidlá pre AI – rovnaké pre režim A (Claude appka) aj B (API). */
export function aiRules(opts: { allowSupplement: boolean }): string {
  return `PRAVIDLÁ
1. Píš po slovensky (ak je prednáška v inom jazyku, píš jazykom prednášky). Odborné termíny zachovaj.
2. Vychádzaj výlučne z prepisu prednášky (a priložených fotiek) a nič si nevymýšľaj.${
    opts.allowSupplement
      ? ' Krátke vysvetľujúce doplnenie mimo prednášky je povolené len vtedy, keď je zjavne užitočné, a musí byť viditeľne označené ako „**Doplnenie (mimo prednášky):** …“.'
      : ' Nepridávaj žiadne informácie mimo prednášky.'
  }
3. Prepis je automatický a obsahuje chyby. V texte materiálu oprav zjavne zle rozpoznané slová a termíny, ale citáty (pole „citat“) preberaj PRESNE z prepisu, doslova, aj s chybami prepisu.
4. Typ „vyslovne“ v „naSkuske“ a zvýraznenie typu „skuska“ patrí LEN tomu, o čom vyučujúci výslovne povedal, že bude na skúške / písomke / teste / zápočte alebo že sa to bude pýtať – vždy s presným citátom tej vety a časom. Zdôraznenie bez zmienky o skúške je „zdoraznene“ (resp. zvýraznenie „dolezite“). Obsah ±60 s okolo študentových značiek ⭐/🎯 spracuj obzvlášť dôkladne; ak sa pri 🎯 vyučujúci o skúške výslovne nevyjadril, použi typ „oznacene“.
5. Organizačné informácie (termíny písomiek, podmienky zápočtu, čo priniesť, zmeny rozvrhu) daj do samostatnej časti „organizacne“.
6. Štruktúruj materiál podľa tém, nie doslovne chronologicky. Každá sekcia má časový rozsah (casOd, casDo).
7. Vzorce píš v LaTeX ($...$ v texte, $$...$$ samostatne) a vysvetli veličiny aj jednotky. Definície uvádzaj presne. Príklady vyučujúceho zachovaj vrátane čísel a postupu.
8. Miesta, kde prepis nedáva zmysel, uveď v zozname „naOverenie“.
9. Časy uvádzaj vo formáte mm:ss podľa značiek [mm:ss] v prepise (minúty môžu byť aj viac ako 59).
10. Výstup je iba platný JSON podľa schémy – žiadny iný text.`
}

export function testRules(opts: { examShare: number; count?: number; types?: QuestionType[]; difficulty?: number[]; onlyExam?: boolean }): string {
  const typeText = opts.types?.length ? opts.types.join(', ') : 'jedna, viac, pravdaNepravda, doplnenie, otvorena, vypocet'
  return `PRAVIDLÁ PRE TESTOVÉ OTÁZKY
- Otázky musia byť jednoznačné; nesprávne možnosti vierohodné (typické omyly), nikdy „všetky uvedené“ ani „žiadna z uvedených“.
- Odpovede vychádzajú len z prednášky. Každá otázka má vysvetlenie a zdroj (sekciaId, cas, citat – presný citát z prepisu).
- ${opts.onlyExam ? 'Všetky otázky musia byť zo skúškových tém.' : `Aspoň ${opts.examShare} % otázok musí byť zo skúškových tém (skuskova: true).`}
- Použi mix typov (${typeText}) a obtiažností${opts.difficulty?.length ? ` (povolené obtiažnosti: ${opts.difficulty.join(', ')})` : ' 1–3'}; ak prednáška obsahovala výpočty, pridaj výpočtové otázky (typ „vypocet“ s tolerancia a jednotka).
- Indexy možností sa počítajú od 0. Pri „doplnenie“ označ vynechané miesto ako ___ a do „spravne“ daj všetky prijateľné tvary odpovede.${
    opts.count ? `\n- Počet otázok: presne ${opts.count}.` : ''
  }`
}

const OUTPUT_A = `FORMÁT ODPOVEDE (DÔLEŽITÉ)
Odpovedz IBA jedným blokom kódu \`\`\`json … \`\`\` s platným JSON. Žiadny text pred ním ani za ním. Nepoužívaj artefakty, nevytváraj súbory a nepoužívaj webové vyhľadávanie.
Ak sa odpoveď nezmestí do jednej správy, skonči uprostred – po mojom „pokračuj“ pokračuj presne od miesta, kde si skončil (opäť v bloku kódu, bez opakovania).
V JSON reťazcoch správne escapuj spätné lomky v LaTeX-e (napr. "\\\\frac{N}{A}") a úvodzovky.`

const OUTPUT_B = `Výsledok odovzdaj výhradne zavolaním nástroja (tool) s celým JSON objektom. Nepíš žiadny iný text.`

export function marksText(marks: Mark[]): string {
  const m = marks.filter((x) => x.type !== 'gap').sort((a, b) => a.t - b.t)
  if (!m.length) return '(žiadne)'
  return m.map((x) => `[${fmtTime(x.t)}] ${x.type === 'exam' ? '🎯 študent označil: „bude na skúške“' : '⭐ študent označil: „dôležité“'}`).join('\n')
}

export function candidatesText(paragraphs: Paragraph[], totalSec?: number): string {
  const cues = findCues(paragraphs, totalSec)
  if (!cues.length) return '(žiadne)'
  const label = { skuska: 'SKÚŠKA', dolezite: 'DÔLEŽITÉ', organizacne: 'ORGANIZAČNÉ' }
  return cues.map((c) => `[${fmtTime(c.t)}] (${label[c.typ]}) „${c.citat}“`).join('\n')
}

export interface MaterialPromptInput {
  title: string
  subject: string
  paragraphs: Paragraph[]
  marks: Mark[]
  totalSec?: number
  allowSupplement: boolean
  examShare: number
  mode: 'claudeApp' | 'api'
  /** Pri rozdelení na časti: { index (1-based), count } */
  part?: { index: number; count: number }
  photosNote?: string
}

export const MATERIAL_SCHEMA_JSON = () => JSON.stringify(jsonSchemaFor(MaterialSchema))

export function systemPrompt(): string {
  return 'Si skúsený vysokoškolský pedagóg a autor študijných materiálov. Z prepisu prednášky vytváraš prehľadný, presný učebný materiál a testové otázky pre študenta, ktorý sa pripravuje na skúšku.'
}

/** Kompletné zadanie pre vytvorenie materiálu (v režime A vrátane schémy a formátu výstupu). */
export function buildMaterialPrompt(inp: MaterialPromptInput): string {
  const partNote = inp.part
    ? `\nToto je ČASŤ ${inp.part.index} Z ${inp.part.count} prednášky. Vytvor materiál len z tejto časti (ostatné časti spracujem zvlášť a spojím). Test: 6–8 otázok.`
    : '\nTest („test“): 10–15 úvodných otázok.'
  const head = inp.mode === 'claudeApp' ? `${systemPrompt()}\n\n` : ''
  return `${head}ÚLOHA
Vytvor učebný materiál z prednášky „${inp.title}“ (predmet: ${inp.subject}).${partNote}

${aiRules({ allowSupplement: inp.allowSupplement })}

${testRules({ examShare: inp.examShare })}

${inp.mode === 'claudeApp' ? `JSON SCHÉMA VÝSTUPU\n${MATERIAL_SCHEMA_JSON()}\n\n${OUTPUT_A}` : OUTPUT_B}

KANDIDÁTI – vety, ktoré appka automaticky našla (over ich v prepise, môžu byť aj falošné):
${candidatesText(inp.paragraphs, inp.totalSec)}

ŠTUDENTOVE ZNAČKY počas prednášky:
${marksText(inp.marks)}
${inp.photosNote ? `\n${inp.photosNote}\n` : ''}
PREPIS PREDNÁŠKY (automatický, s chybami):
<prepis>
${transcriptToText(inp.paragraphs)}
</prepis>`
}

export interface NewTestPromptInput {
  material: Material
  existing: Question[]
  count: number
  types: QuestionType[]
  difficulty: number[]
  onlyExam: boolean
  examShare: number
  mode: 'claudeApp' | 'api'
  paragraphs?: Paragraph[]
}

/** Zadanie pre „Nový test“ – materiál + zoznam existujúcich otázok, aby sa neopakovali. */
export function buildNewTestPrompt(inp: NewTestPromptInput): string {
  const head = inp.mode === 'claudeApp' ? `${systemPrompt()}\n\n` : ''
  const mat = { ...inp.material, test: undefined, karticky: undefined }
  return `${head}ÚLOHA
Vytvor NOVÝ test s ${inp.count} otázkami z učebného materiálu nižšie. Otázky sa nesmú opakovať s existujúcimi otázkami (zoznam nižšie) – pýtaj sa na iné veci alebo iným spôsobom.

${testRules({ examShare: inp.examShare, count: inp.count, types: inp.types, difficulty: inp.difficulty, onlyExam: inp.onlyExam })}
- Povolené typy otázok: ${inp.types.join(', ')}.

${inp.mode === 'claudeApp' ? `JSON SCHÉMA VÝSTUPU\n${JSON.stringify(jsonSchemaFor(NewTestSchema))}\n\n${OUTPUT_A}` : OUTPUT_B}

EXISTUJÚCE OTÁZKY (neopakovať):
${inp.existing.length ? inp.existing.map((q) => `- ${q.otazka}`).join('\n') : '(žiadne)'}

UČEBNÝ MATERIÁL (JSON):
${JSON.stringify(mat)}
${inp.paragraphs?.length ? `\nPREPIS PREDNÁŠKY (na citáty v poli zdroj.citat):\n<prepis>\n${transcriptToText(inp.paragraphs)}\n</prepis>` : ''}`
}

/** Opravná výzva po neplatnej odpovedi. */
export function buildRepairPrompt(errors: string[], kind: 'material' | 'test'): string {
  return `Tvoja predchádzajúca odpoveď sa nedala spracovať. Problémy:
${errors.map((e) => `- ${e}`).join('\n')}

Pošli prosím znova CELÝ ${kind === 'material' ? 'materiál' : 'test'} ako platný JSON podľa tej istej schémy – IBA jeden blok kódu \`\`\`json … \`\`\`, bez textu okolo. Ak sa nezmestí do jednej správy, skonči uprostred a po „pokračuj“ pokračuj presne tam, kde si prestal.`
}

export function buildGradePrompt(q: Extract<Question, { typ: 'otvorena' }>, answer: string): string {
  return `Ohodnoť odpoveď študenta na otvorenú otázku z prednášky. Hodnoť vecne a zhovievavo k formulácii, prísne k obsahu.

OTÁZKA: ${q.otazka}
VZOROVÁ ODPOVEĎ: ${q.vzorovaOdpoved}
KĽÚČOVÉ BODY: ${q.kluceveBody.join('; ')}

ODPOVEĎ ŠTUDENTA:
${answer || '(prázdna)'}

Vráť skóre 0 (nevedel), 0.5 (čiastočne) alebo 1 (vedel), krátke hodnotenie po slovensky a zoznam chýbajúcich kľúčových bodov. Výsledok odovzdaj zavolaním nástroja.`
}

export const GRADE_SCHEMA_JSON = () => jsonSchemaFor(GradeSchema)

/** Rozdelí odseky na n približne rovnakých častí podľa dĺžky textu. */
export function splitParagraphs(paragraphs: Paragraph[], n: number): Paragraph[][] {
  if (n <= 1) return [paragraphs]
  const total = paragraphs.reduce((s, p) => s + p.text.length, 0)
  const target = total / n
  const out: Paragraph[][] = [[]]
  let acc = 0
  for (const p of paragraphs) {
    if (acc >= target * out.length && out.length < n) out.push([])
    out[out.length - 1].push(p)
    acc += p.text.length
  }
  return out.filter((x) => x.length)
}

/** Odporúčaná hranica pre režim A (dĺžka promptu v znakoch). */
export const CLAUDE_APP_LIMIT = 150_000
