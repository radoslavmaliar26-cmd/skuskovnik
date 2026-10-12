import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { loadDemo } from '../demo/loadDemo'
import { DEMO_MATERIAL } from '../demo/demoMaterial'
import { scoreQuestion } from './scoring'
import { buildSubjectTest, createRetryTest, finishAttempt, saveAnswer, startAttempt } from './tests'

describe('pokusy, zopakovanie chýb a test z predmetu', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('demo: pokus → vyhodnotenie → zopakovanie chybných', async () => {
    const lectureId = await loadDemo()
    const test = (await db.tests.where('lectureId').equals(lectureId).toArray())[0]
    expect(test.questions).toHaveLength(DEMO_MATERIAL.test.length)
    const a = await startAttempt(test.id)
    // rozpracovaný pokus sa obnoví
    expect((await startAttempt(test.id)).id).toBe(a.id)
    // prvé dve otázky zle, ostatné dobre
    for (const [i, q] of test.questions.entries()) {
      const answer = i < 2 ? null : q.typ === 'jedna' || q.typ === 'viac' || q.typ === 'pravdaNepravda' ? q.spravne : q.typ === 'doplnenie' ? q.spravne[0] : q.typ === 'vypocet' ? String(q.spravne) : 'x'
      await saveAnswer(a.id, q.id, answer as never, scoreQuestion(q, answer as never, { selfGrade: 'vedel' }))
    }
    const done = await finishAttempt(a.id)
    expect(done?.score).toBe(test.questions.length - 2)
    expect(done?.finishedAt).toBeTruthy()
    const retry = await createRetryTest({ attemptId: a.id })
    expect(retry?.questions.map((q) => q.otazka)).toEqual(test.questions.slice(0, 2).map((q) => q.otazka))
    expect(retry?.origin).toBe('retry')
    const retry2 = await createRetryTest({ lectureId })
    expect(retry2?.questions).toHaveLength(2)
  })

  it('test z celého predmetu uprednostní skúškové otázky a pamätá si prednášku', async () => {
    const lectureId = await loadDemo()
    const lecture = await db.lectures.get(lectureId)
    const t = await buildSubjectTest(lecture!.subjectId, 5, false, () => 0.3)
    expect(t?.questions).toHaveLength(5)
    expect(t?.questions.every((q) => q.skuskova)).toBe(true)
    expect(Object.values(t?.questionLectures ?? {}).every((l) => l === lectureId)).toBe(true)
    const all = await buildSubjectTest(lecture!.subjectId, 100, true)
    expect(all?.questions.length).toBe(DEMO_MATERIAL.test.filter((q) => q.skuskova).length)
  })
})
