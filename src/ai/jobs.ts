import { addUsage, db, getSettings } from '../db/db'
import type { Mark, Paragraph, Settings, StoredMaterial } from '../db/types'
import { ApiError } from '../lib/httpErrors'
import { Store } from '../ui/hooks'
import { AnthropicProvider, type ContentBlock, type LlmProvider, type StructuredResult } from './anthropic'
import { saveMaterial } from './materialStore'
import { mergeMaterials } from './merge'
import { parseGradeResponse, parseMaterialResponse, parseNewTestResponse, validateGrade, validateMaterial, validateNewTest } from './parser'
import { buildGradePrompt, buildMaterialPrompt, buildNewTestPrompt, splitParagraphs, systemPrompt } from './prompts'
import { GradeSchema, jsonSchemaFor, MaterialSchema, NewTestSchema, type Grade, type Material, type Question, type QuestionType } from './schema'
import { photosForPrompt } from './photos'

/** Generovanie cez Anthropic API (režim B) s priebehom a obnovou. */

export interface GenState {
  phase: 'running' | 'done' | 'error'
  message: string
  chars: number
  part: number
  parts: number
  startedAt: number
}

export const genState = new Store<Record<string, GenState>>({})
const controllers = new Map<string, AbortController>()

function setGen(lectureId: string, patch: Partial<GenState>) {
  genState.set((s) => ({
    ...s,
    [lectureId]: { ...(s[lectureId] ?? { phase: 'running', message: '', chars: 0, part: 1, parts: 1, startedAt: Date.now() }), ...patch },
  }))
}

let providerOverride: LlmProvider | null = null
/** Pre testy – podstrčí poskytovateľa. */
export function setLlmProviderForTests(p: LlmProvider | null) {
  providerOverride = p
}

export function llmProvider(settings: Settings): LlmProvider | null {
  if (providerOverride) return providerOverride
  const key = settings.keys.anthropic.trim()
  return key ? new AnthropicProvider(key) : null
}

/** Znakov prepisu na jednu časť – dlhšie prednášky sa delia, aby sa výstup zmestil do max_tokens. */
const CHARS_PER_PART = 120_000
const MAX_PARTS = 4

function marksInRange(marks: Mark[], from: number, to: number) {
  return marks.filter((m) => m.t >= from - 1 && m.t < to + 1)
}

/** Vytiahne a zvaliduje materiál z výsledku (vstup nástroja, inak text/JSON). */
export function materialFromResult(res: StructuredResult) {
  if (res.input && typeof res.input === 'object') {
    const v = validateMaterial(res.input)
    if (v.ok) return v
  }
  const candidates = [res.rawToolJson, res.text].filter((x) => x && x.trim())
  for (const c of candidates) {
    const r = parseMaterialResponse([c])
    if (r.ok) return r
  }
  return res.input ? validateMaterial(res.input) : parseMaterialResponse([res.text || res.rawToolJson])
}

export async function generateMaterialApi(lectureId: string): Promise<void> {
  const settings = await getSettings()
  const provider = llmProvider(settings)
  if (!provider) throw new ApiError('auth', 'Na automatické vytvorenie treba Anthropic API kľúč (Nastavenia). Alebo použi režim „Cez Claude appku“.')
  const lecture = await db.lectures.get(lectureId)
  if (!lecture) throw new Error('Prednáška neexistuje.')
  const transcript = await db.transcripts.get(lectureId)
  const paragraphs: Paragraph[] = transcript?.paragraphs ?? []
  if (!paragraphs.length) throw new Error('Prednáška ešte nemá prepis.')
  const subject = await db.subjects.get(lecture.subjectId)
  const marks = await db.marks.where('lectureId').equals(lectureId).toArray()
  const totalChars = paragraphs.reduce((s, p) => s + p.text.length, 0)

  controllers.get(lectureId)?.abort()
  const ctrl = new AbortController()
  controllers.set(lectureId, ctrl)
  const prevStatus = lecture.status
  await db.lectures.update(lectureId, { status: 'generating', error: undefined, errorStep: undefined, updatedAt: Date.now() })
  setGen(lectureId, { phase: 'running', message: 'Posielam prepis Claudovi…', chars: 0, part: 1, parts: 1, startedAt: Date.now() })

  try {
    let n = Math.min(MAX_PARTS, Math.max(1, Math.ceil(totalChars / CHARS_PER_PART)))
    for (;;) {
      const chunks = splitParagraphs(paragraphs, n)
      const results: Material[] = []
      let truncated = false
      for (let k = 0; k < chunks.length; k++) {
        const chunk = chunks[k]
        const from = chunk[0]?.t ?? 0
        const to = chunks[k + 1]?.[0]?.t ?? Number.POSITIVE_INFINITY
        const prompt = buildMaterialPrompt({
          title: lecture.title,
          subject: subject?.name ?? '',
          paragraphs: chunk,
          marks: marksInRange(marks, from, to),
          totalSec: lecture.durationSec || undefined,
          allowSupplement: settings.allowSupplement,
          examShare: settings.examShare,
          mode: 'api',
          part: chunks.length > 1 ? { index: k + 1, count: chunks.length } : undefined,
        })
        const photos = await photosForPrompt(lectureId, from, to)
        const user: string | ContentBlock[] = photos.blocks.length ? [...photos.blocks, { type: 'text', text: prompt + photos.note }] : prompt
        setGen(lectureId, { part: k + 1, parts: chunks.length, chars: 0, message: chunks.length > 1 ? `Časť ${k + 1}/${chunks.length}` : '' })
        const res = await provider.structured({
          model: settings.anthropicModel || 'claude-sonnet-5-5',
          system: systemPrompt(),
          user,
          toolName: 'ulozit_material',
          toolDescription: 'Uloží hotový učebný materiál z prednášky (celý objekt podľa schémy).',
          inputSchema: jsonSchemaFor(MaterialSchema),
          maxTokens: 64_000,
          signal: ctrl.signal,
          onProgress: (p) =>
            setGen(lectureId, {
              chars: p.chars,
              message: p.phase === 'thinking' && p.chars === 0 ? 'Claude premýšľa…' : 'Claude píše materiál…',
            }),
        })
        await addUsage({ inputTokens: res.usage.input, outputTokens: res.usage.output })
        if (res.stopReason === 'max_tokens') {
          truncated = true
          break
        }
        const v = materialFromResult(res)
        if (!v.ok) throw new Error(`Claude vrátil neplatný materiál: ${v.errors.slice(0, 3).join(' ')}`)
        results.push(v.data)
      }
      if (truncated) {
        if (n >= MAX_PARTS) throw new Error('Prednáška je príliš dlhá – materiál sa nezmestil ani po rozdelení na časti.')
        n = Math.min(MAX_PARTS, n * 2)
        setGen(lectureId, { message: `Výstup bol príliš dlhý – delím prednášku na ${n} časti…` })
        continue
      }
      const merged = mergeMaterials(results, lecture.title)
      await saveMaterial(lectureId, merged, 'api')
      await maybeDeleteAudio(lectureId, settings)
      setGen(lectureId, { phase: 'done', message: 'Hotovo' })
      return
    }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError' || (e as ApiError)?.kind === 'aborted'
    const message = aborted ? 'Vytváranie bolo zrušené.' : ((e as Error)?.message ?? String(e))
    if (aborted) {
      await db.lectures.update(lectureId, { status: prevStatus === 'done' ? 'done' : 'transcribed', updatedAt: Date.now() })
    } else {
      await db.lectures.update(lectureId, { status: 'error', errorStep: 'generate', error: message, updatedAt: Date.now() })
    }
    setGen(lectureId, { phase: 'error', message })
    if (!aborted) throw e
  } finally {
    controllers.delete(lectureId)
  }
}

export function cancelGeneration(lectureId: string) {
  controllers.get(lectureId)?.abort()
}

/** Uloží materiál z režimu A (vložená odpoveď) – jedna alebo viac častí. */
export async function saveMaterialFromApp(lectureId: string, materials: Material[], title?: string) {
  const merged = mergeMaterials(materials, title)
  const res = await saveMaterial(lectureId, merged, 'claudeApp')
  await maybeDeleteAudio(lectureId, await getSettings())
  return res
}

async function maybeDeleteAudio(lectureId: string, settings: Settings) {
  if (!settings.deleteAudioAfter) return
  const { deleteLectureAudio } = await import('../db/db')
  const pending = await db.segments.where('lectureId').equals(lectureId).filter((s) => s.status !== 'done' && s.status !== 'skipped').count()
  if (pending === 0) await deleteLectureAudio(lectureId)
}

export interface NewTestOptions {
  count: number
  types: QuestionType[]
  difficulty: number[]
  onlyExam: boolean
}

export async function generateNewTestApi(material: StoredMaterial, existing: Question[], opts: NewTestOptions, signal?: AbortSignal) {
  const settings = await getSettings()
  const provider = llmProvider(settings)
  if (!provider) throw new ApiError('auth', 'Chýba Anthropic API kľúč.')
  const transcript = await db.transcripts.get(material.lectureId)
  const prompt = buildNewTestPrompt({
    material: material.data,
    existing,
    ...opts,
    examShare: settings.examShare,
    mode: 'api',
    paragraphs: transcript?.paragraphs,
  })
  const res = await provider.structured({
    model: settings.anthropicModel || 'claude-sonnet-5-5',
    system: systemPrompt(),
    user: prompt,
    toolName: 'ulozit_test',
    toolDescription: 'Uloží nový test (zoznam otázok).',
    inputSchema: jsonSchemaFor(NewTestSchema),
    maxTokens: 32_000,
    signal,
  })
  await addUsage({ inputTokens: res.usage.input, outputTokens: res.usage.output })
  let v = res.input ? validateNewTest(res.input) : parseNewTestResponse([res.text || res.rawToolJson])
  if (!v.ok && res.rawToolJson) v = parseNewTestResponse([res.rawToolJson])
  if (!v.ok) throw new Error(`Claude vrátil neplatný test: ${v.errors.slice(0, 3).join(' ')}`)
  return v.data.otazky
}

/** AI hodnotenie otvorenej odpovede (lacný model). */
export async function gradeOpenAnswer(q: Extract<Question, { typ: 'otvorena' }>, answer: string, signal?: AbortSignal): Promise<Grade> {
  const settings = await getSettings()
  const provider = llmProvider(settings)
  if (!provider) throw new ApiError('auth', 'Chýba Anthropic API kľúč.')
  const res = await provider.structured({
    model: settings.anthropicCheapModel || 'claude-haiku-5-5',
    system: 'Si spravodlivý skúšajúci na vysokej škole. Hodnotíš po slovensky.',
    user: buildGradePrompt(q, answer),
    toolName: 'ohodnotit',
    toolDescription: 'Uloží hodnotenie odpovede.',
    inputSchema: jsonSchemaFor(GradeSchema),
    maxTokens: 4000,
    signal,
  })
  await addUsage({ inputTokens: res.usage.input, outputTokens: res.usage.output })
  const v = res.input ? validateGrade(res.input) : parseGradeResponse([res.text])
  if (!v.ok) throw new Error('AI hodnotenie sa nepodarilo.')
  return v.data
}

/** Po štarte appky: generovanie, ktoré bežalo pri zatvorení, sa nedá dokončiť – ponúkni „Skúsiť znova“. */
export async function recoverGenerations() {
  const ls = await db.lectures.where('status').equals('generating').toArray()
  for (const l of ls) {
    if (controllers.has(l.id)) continue
    const hasMaterial = await db.materials.get(l.id)
    await db.lectures.update(l.id, hasMaterial
      ? { status: 'done' }
      : {
          status: 'error',
          errorStep: 'generate',
          error: 'Vytváranie materiálu sa prerušilo (appka bola zatvorená alebo v pozadí). Ťukni na „Skúsiť znova“.',
        })
  }
}
