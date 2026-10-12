import type { Material, Question } from '../ai/schema'

export type Lang = 'sk' | 'cs' | 'en' | 'auto'

export interface Subject {
  id: string
  name: string
  language: Lang
  /** Slovník pojmov predmetu – posiela sa ako prompt pre prepis */
  glossary: string
  createdAt: number
}

export type LectureStatus =
  | 'draft'
  | 'recording'
  | 'transcribing'
  | 'transcribed'
  | 'generating'
  | 'done'
  | 'error'

export type LectureSource = 'record' | 'import' | 'text' | 'demo'

export interface Lecture {
  id: string
  subjectId: string
  title: string
  createdAt: number
  source: LectureSource
  status: LectureStatus
  /** Chybová správa pre stav 'error' */
  error?: string
  /** V ktorom kroku nastala chyba – kam sa vrátiť pri „Skúsiť znova“ */
  errorStep?: 'transcribe' | 'generate'
  /** Celková dĺžka nahrávky (bez páuz) v sekundách */
  durationSec: number
  /** Nahrávanie bolo prerušené a čaká na „Pokračovať v nahrávaní“ */
  interrupted?: boolean
  audioDeleted?: boolean
  updatedAt: number
}

export type SegmentStatus = 'recording' | 'pending' | 'transcribing' | 'done' | 'skipped' | 'error'

export interface TranscriptPart {
  /** Absolútny čas v prednáške (s) */
  start: number
  end: number
  text: string
}

export interface Segment {
  id: string
  lectureId: string
  index: number
  /** Začiatok segmentu v čase prednášky (bez páuz), s */
  startSec: number
  durationSec: number
  mime: string
  ext: string
  /** Či segment obsahoval reč (podľa hlasitosti). Tiché sa neposielajú na prepis. */
  hasSpeech: boolean
  status: SegmentStatus
  attempts: number
  nextAttemptAt: number
  error?: string
  /** Typ chyby – určuje, či má zmysel automaticky opakovať */
  errorKind?: string
  size: number
  parts?: TranscriptPart[]
  /** Pred týmto segmentom bola medzera (prerušené nahrávanie) */
  gapBefore?: boolean
  createdAt: number
}

export interface AudioChunk {
  id?: number
  segmentId: string
  seq: number
  data: ArrayBuffer
}

export interface Paragraph {
  t: number
  text: string
}

export interface Transcript {
  lectureId: string
  paragraphs: Paragraph[]
  /** Ručne upravené */
  edited: boolean
  updatedAt: number
}

export type MarkType = 'star' | 'exam' | 'gap'

export interface Mark {
  id: string
  lectureId: string
  type: MarkType
  t: number
  createdAt: number
}

export interface StoredMaterial {
  lectureId: string
  data: Material
  mode: 'claudeApp' | 'api' | 'demo'
  createdAt: number
}

export interface StoredTest {
  id: string
  lectureId: string | null
  subjectId: string
  title: string
  questions: Question[]
  origin: 'material' | 'new' | 'retry' | 'subject'
  createdAt: number
}

export interface QuestionResult {
  /** 0..1 */
  score: number
  correct: boolean
  /** Samohodnotenie / AI hodnotenie otvorenej otázky */
  selfGrade?: 'vedel' | 'ciastocne' | 'nevedel'
  aiFeedback?: string
}

export type Answer = number | number[] | boolean | string | null

export interface Attempt {
  id: string
  testId: string
  subjectId: string
  lectureId: string | null
  answers: Record<string, Answer>
  results: Record<string, QuestionResult>
  score: number
  max: number
  startedAt: number
  finishedAt?: number
}

export interface Card {
  id: string
  lectureId: string
  subjectId: string
  otazka: string
  odpoved: string
  sekciaId?: string
  skuskova: boolean
  /** Leitnerov priečinok 1–5 */
  box: number
  due: number
  updatedAt: number
}

export interface Photo {
  id: string
  lectureId: string
  t: number
  mime: string
  data: ArrayBuffer
  createdAt: number
}

export interface Usage {
  id: string
  /** sekundy audia poslané na prepis */
  audioSec: number
  inputTokens: number
  outputTokens: number
}

export type TranscriptionProviderId = 'groq' | 'openai' | 'custom'
export type AiMode = 'claudeApp' | 'api'

export interface Settings {
  id: 'app'
  onboarded: boolean
  provider: TranscriptionProviderId
  keys: { groq: string; openai: string; custom: string; anthropic: string }
  models: { groq: string; openai: string; custom: string }
  customBaseUrl: string
  segmentMinutes: number
  /** null = automaticky (API ak je kľúč, inak Claude appka) */
  aiMode: AiMode | null
  anthropicModel: string
  anthropicCheapModel: string
  allowSupplement: boolean
  /** Percento skúškových otázok v teste */
  examShare: number
  instantFeedback: boolean
  aiGrading: boolean
  fontScale: number
  deleteAudioAfter: boolean
  blackScreen: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  onboarded: false,
  provider: 'groq',
  keys: { groq: '', openai: '', custom: '', anthropic: '' },
  models: { groq: 'whisper-large-v3', openai: 'gpt-4o-transcribe', custom: 'whisper-1' },
  customBaseUrl: '',
  segmentMinutes: 5,
  aiMode: null,
  anthropicModel: 'claude-sonnet-5-5',
  anthropicCheapModel: 'claude-haiku-5-5',
  allowSupplement: true,
  examShare: 50,
  instantFeedback: true,
  aiGrading: true,
  fontScale: 1,
  deleteAudioAfter: false,
  blackScreen: false,
}

export function effectiveAiMode(s: Settings): AiMode {
  if (s.aiMode) return s.aiMode
  return s.keys.anthropic.trim() ? 'api' : 'claudeApp'
}
