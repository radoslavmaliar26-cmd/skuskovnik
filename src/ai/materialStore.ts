import { db } from '../db/db'
import type { Card, StoredMaterial, StoredTest } from '../db/types'
import { uid } from '../lib/text'
import type { Material } from './schema'
import { verifyMaterial } from './verify'

/**
 * Uloží vygenerovaný materiál: overí citáty voči prepisu, vytvorí úvodný test a kartičky
 * a prednášku označí ako hotovú.
 */
export async function saveMaterial(lectureId: string, material: Material, mode: StoredMaterial['mode']) {
  const lecture = await db.lectures.get(lectureId)
  if (!lecture) throw new Error('Prednáška neexistuje.')
  const transcript = await db.transcripts.get(lectureId)
  const verified = verifyMaterial(JSON.parse(JSON.stringify(material)) as Material, transcript?.paragraphs ?? [], lecture.durationSec || undefined)
  const data = verified.material
  const now = Date.now()

  await db.transaction('rw', [db.materials, db.tests, db.cards, db.lectures, db.attempts], async () => {
    await db.materials.put({ lectureId, data, mode, createdAt: now })
    // úvodný test z materiálu nahradí predchádzajúci (pokusy k nemu zmažeme)
    const old = await db.tests.where('lectureId').equals(lectureId).filter((t) => t.origin === 'material').toArray()
    for (const t of old) {
      await db.attempts.where('testId').equals(t.id).delete()
      await db.tests.delete(t.id)
    }
    if (data.test.length) {
      const test: StoredTest = {
        id: uid(),
        lectureId,
        subjectId: lecture.subjectId,
        title: 'Úvodný test',
        questions: data.test,
        origin: 'material',
        createdAt: now,
      }
      await db.tests.put(test)
    }
    // kartičky – zachovaj pokrok pri rovnakej otázke
    const oldCards = await db.cards.where('lectureId').equals(lectureId).toArray()
    const byQ = new Map(oldCards.map((c) => [c.otazka.trim(), c]))
    await db.cards.where('lectureId').equals(lectureId).delete()
    const cards: Card[] = data.karticky.map((k) => {
      const prev = byQ.get(k.otazka.trim())
      return {
        id: uid(),
        lectureId,
        subjectId: lecture.subjectId,
        otazka: k.otazka,
        odpoved: k.odpoved,
        sekciaId: k.sekciaId || undefined,
        skuskova: k.skuskova,
        box: prev?.box ?? 1,
        due: prev?.due ?? now,
        updatedAt: now,
      }
    })
    await db.cards.bulkPut(cards)
    await db.lectures.update(lectureId, { status: 'done', error: undefined, errorStep: undefined, updatedAt: now })
  })
  return verified
}
