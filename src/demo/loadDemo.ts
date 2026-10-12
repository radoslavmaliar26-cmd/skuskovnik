import { saveMaterial } from '../ai/materialStore'
import { db } from '../db/db'
import { uid } from '../lib/text'
import { parsePastedTranscript } from '../transcription/assemble'
import { DEMO_MATERIAL } from './demoMaterial'
import { DEMO_TRANSCRIPT } from './demoTranscript'

export const DEMO_SUBJECT_NAME = 'Pružnosť a pevnosť (ukážka)'

/** Vytvorí ukážkový predmet a prednášku s hotovým materiálom a testom. Vráti id prednášky. */
export async function loadDemo(): Promise<string> {
  const existing = await db.lectures.filter((l) => l.source === 'demo').first()
  if (existing) return existing.id
  let subject = await db.subjects.where('name').equals(DEMO_SUBJECT_NAME).first()
  const now = Date.now()
  if (!subject) {
    subject = {
      id: uid(),
      name: DEMO_SUBJECT_NAME,
      language: 'sk',
      glossary: 'napätie, pomerné pretvorenie, Hookov zákon, modul pružnosti, medza klzu, Poissonovo číslo',
      createdAt: now,
    }
    await db.subjects.put(subject)
  }
  const paragraphs = parsePastedTranscript(DEMO_TRANSCRIPT)
  const id = uid()
  await db.lectures.put({
    id,
    subjectId: subject.id,
    title: '1. prednáška – Úvod do pružnosti',
    createdAt: now,
    source: 'demo',
    status: 'transcribed',
    durationSec: 41 * 60 + 30,
    updatedAt: now,
  })
  await db.transcripts.put({ lectureId: id, paragraphs, edited: false, updatedAt: now })
  await db.marks.bulkPut([
    { id: uid(), lectureId: id, type: 'star', t: 19 * 60 + 50, createdAt: now },
    { id: uid(), lectureId: id, type: 'exam', t: 38 * 60 + 45, createdAt: now },
  ])
  await saveMaterial(id, DEMO_MATERIAL, 'demo')
  return id
}
