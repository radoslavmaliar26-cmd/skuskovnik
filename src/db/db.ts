import Dexie, { type Table } from 'dexie'
import type {
  Attempt, AudioChunk, Card, Lecture, Mark, Photo, Segment, Settings, StoredMaterial,
  StoredTest, Subject, Transcript, Usage,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { uid } from '../lib/text'

export class SkuskovnikDB extends Dexie {
  subjects!: Table<Subject, string>
  lectures!: Table<Lecture, string>
  segments!: Table<Segment, string>
  chunks!: Table<AudioChunk, number>
  transcripts!: Table<Transcript, string>
  marks!: Table<Mark, string>
  materials!: Table<StoredMaterial, string>
  tests!: Table<StoredTest, string>
  attempts!: Table<Attempt, string>
  cards!: Table<Card, string>
  photos!: Table<Photo, string>
  usage!: Table<Usage, string>
  settings!: Table<Settings, string>

  constructor(name = 'skuskovnik') {
    super(name, { cache: 'disabled' })
    this.version(1).stores({
      subjects: 'id, name, createdAt',
      lectures: 'id, subjectId, status, createdAt',
      segments: 'id, lectureId, status, [lectureId+index]',
      chunks: '++id, segmentId, [segmentId+seq]',
      transcripts: 'lectureId',
      marks: 'id, lectureId',
      materials: 'lectureId',
      tests: 'id, lectureId, subjectId, createdAt',
      attempts: 'id, testId, subjectId, lectureId, startedAt',
      cards: 'id, lectureId, subjectId, due',
      photos: 'id, lectureId',
      usage: 'id',
      settings: 'id',
    })
  }
}

export const db = new SkuskovnikDB()

export function mergeSettings(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    keys: { ...DEFAULT_SETTINGS.keys, ...(s?.keys ?? {}) },
    models: { ...DEFAULT_SETTINGS.models, ...(s?.models ?? {}) },
    id: 'app',
  }
}

export async function getSettings(): Promise<Settings> {
  return mergeSettings(await db.settings.get('app'))
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  const next = mergeSettings({ ...cur, ...patch })
  await db.settings.put(next)
  return next
}

export async function getSegmentChunks(segmentId: string) {
  return db.chunks.where('[segmentId+seq]').between([segmentId, Dexie.minKey], [segmentId, Dexie.maxKey]).toArray()
}

/** Zostaví celý zvukový súbor segmentu z kúskov. */
export async function getSegmentBlob(seg: Segment): Promise<Blob | null> {
  const chunks = await getSegmentChunks(seg.id)
  if (!chunks.length) return null
  return new Blob(chunks.map((c) => c.data), { type: seg.mime })
}

export async function addUsage(patch: Partial<Omit<Usage, 'id'>>) {
  await db.transaction('rw', db.usage, async () => {
    const cur = (await db.usage.get('total')) ?? { id: 'total', audioSec: 0, inputTokens: 0, outputTokens: 0 }
    await db.usage.put({
      id: 'total',
      audioSec: cur.audioSec + (patch.audioSec ?? 0),
      inputTokens: cur.inputTokens + (patch.inputTokens ?? 0),
      outputTokens: cur.outputTokens + (patch.outputTokens ?? 0),
    })
  })
}

export async function createSubject(name: string, language: Subject['language'] = 'sk'): Promise<Subject> {
  const trimmed = name.trim() || 'Bez predmetu'
  const existing = await db.subjects.where('name').equals(trimmed).first()
  if (existing) return existing
  const s: Subject = { id: uid(), name: trimmed, language, glossary: '', createdAt: Date.now() }
  await db.subjects.add(s)
  return s
}

export async function createLecture(subjectId: string, title: string, source: Lecture['source']): Promise<Lecture> {
  const now = Date.now()
  const l: Lecture = {
    id: uid(),
    subjectId,
    title: title.trim() || 'Prednáška',
    createdAt: now,
    source,
    status: 'draft',
    durationSec: 0,
    updatedAt: now,
  }
  await db.lectures.add(l)
  return l
}

/** Zmaže prednášku so všetkými súvisiacimi dátami. */
export async function deleteLecture(id: string) {
  await db.transaction(
    'rw',
    [db.lectures, db.segments, db.chunks, db.transcripts, db.marks, db.materials, db.tests, db.attempts, db.cards, db.photos],
    async () => {
      const segs = await db.segments.where('lectureId').equals(id).primaryKeys()
      for (const sid of segs) await db.chunks.where('segmentId').equals(sid).delete()
      await db.segments.where('lectureId').equals(id).delete()
      await db.transcripts.delete(id)
      await db.marks.where('lectureId').equals(id).delete()
      await db.materials.delete(id)
      const tests = await db.tests.where('lectureId').equals(id).primaryKeys()
      for (const t of tests) await db.attempts.where('testId').equals(t).delete()
      await db.tests.where('lectureId').equals(id).delete()
      await db.cards.where('lectureId').equals(id).delete()
      await db.photos.where('lectureId').equals(id).delete()
      await db.lectures.delete(id)
    },
  )
}

/** Zmaže audio prednášky (prepis zostáva). */
export async function deleteLectureAudio(id: string) {
  await db.transaction('rw', [db.segments, db.chunks, db.lectures], async () => {
    const segs = await db.segments.where('lectureId').equals(id).primaryKeys()
    for (const sid of segs) await db.chunks.where('segmentId').equals(sid).delete()
    await db.lectures.update(id, { audioDeleted: true })
  })
}
