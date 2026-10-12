import type { Question } from '../ai/schema'
import { db } from '../db/db'
import type { Answer, Attempt, QuestionResult, StoredTest } from '../db/types'
import { uid } from '../lib/text'
import { summarize } from './scoring'

/** Začne nový pokus, alebo vráti rozpracovaný (nedokončený) pokus k testu. */
export async function startAttempt(testId: string, fresh = false): Promise<Attempt> {
  const test = await db.tests.get(testId)
  if (!test) throw new Error('Test neexistuje.')
  if (!fresh) {
    const open = await db.attempts.where('testId').equals(testId).filter((a) => !a.finishedAt).first()
    if (open) return open
  }
  const a: Attempt = {
    id: uid(),
    testId,
    subjectId: test.subjectId,
    lectureId: test.lectureId,
    answers: {},
    results: {},
    score: 0,
    max: test.questions.length,
    startedAt: Date.now(),
  }
  await db.attempts.put(a)
  return a
}

export async function saveAnswer(attemptId: string, qid: string, answer: Answer, result: QuestionResult) {
  await db.transaction('rw', db.attempts, async () => {
    const a = await db.attempts.get(attemptId)
    if (!a) return
    a.answers[qid] = answer
    a.results[qid] = result
    await db.attempts.put(a)
  })
}

export async function finishAttempt(attemptId: string): Promise<Attempt | undefined> {
  const a = await db.attempts.get(attemptId)
  if (!a) return
  const test = await db.tests.get(a.testId)
  const s = summarize(test?.questions ?? [], a.results)
  const done = { ...a, score: s.score, max: s.max, finishedAt: Date.now() }
  await db.attempts.put(done)
  return done
}

/** Lokálne zamiešanie poradia (Fisher–Yates). */
export function shuffle<T>(arr: T[], rnd = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Vytvorí test z otázok, ktoré boli zodpovedané chybne (alebo len čiastočne). */
export async function createRetryTest(source: { attemptId?: string; lectureId?: string; subjectId?: string }): Promise<StoredTest | null> {
  const wrong: Question[] = []
  const seen = new Set<string>()
  const qLect: Record<string, string> = {}
  let subjectId = source.subjectId ?? ''
  let lectureId: string | null = source.lectureId ?? null

  const collect = async (attempt: Attempt) => {
    const test = await db.tests.get(attempt.testId)
    if (!test) return
    subjectId = test.subjectId
    for (const q of test.questions) {
      const r = attempt.results[q.id]
      if (!r || r.correct) continue
      const key = q.otazka.trim()
      if (seen.has(key)) continue
      seen.add(key)
      const id = `r${wrong.length + 1}`
      wrong.push({ ...q, id })
      const lid = test.questionLectures?.[q.id] ?? test.lectureId
      if (lid) qLect[id] = lid
    }
  }

  if (source.attemptId) {
    const a = await db.attempts.get(source.attemptId)
    if (a) {
      lectureId = a.lectureId
      await collect(a)
    }
  } else {
    // posledný dokončený pokus každého testu prednášky / predmetu
    const attempts = source.lectureId
      ? await db.attempts.where('lectureId').equals(source.lectureId).toArray()
      : await db.attempts.where('subjectId').equals(source.subjectId ?? '').toArray()
    const latest = new Map<string, Attempt>()
    for (const a of attempts.filter((x) => x.finishedAt)) {
      const prev = latest.get(a.testId)
      if (!prev || (prev.finishedAt ?? 0) < (a.finishedAt ?? 0)) latest.set(a.testId, a)
    }
    for (const a of latest.values()) await collect(a)
  }
  if (!wrong.length) return null
  const test: StoredTest = {
    id: uid(),
    lectureId,
    subjectId,
    title: `Zopakovanie chýb (${wrong.length})`,
    questions: wrong,
    origin: 'retry',
    createdAt: Date.now(),
    questionLectures: Object.keys(qLect).length ? qLect : undefined,
  }
  await db.tests.put(test)
  return test
}

/** Uloží nový test vygenerovaný AI. */
export async function saveNewTest(lectureId: string, subjectId: string, questions: Question[], title?: string): Promise<StoredTest> {
  const existing = await db.tests.where('lectureId').equals(lectureId).count()
  const test: StoredTest = {
    id: uid(),
    lectureId,
    subjectId,
    title: title ?? `Test ${existing + 1}`,
    questions,
    origin: 'new',
    createdAt: Date.now(),
  }
  await db.tests.put(test)
  return test
}

/**
 * Test z celého predmetu poskladaný lokálne z otázok všetkých prednášok
 * (skúškové otázky prednostne).
 */
export async function buildSubjectTest(subjectId: string, count: number, onlyExam: boolean, rnd = Math.random): Promise<StoredTest | null> {
  const tests = await db.tests.where('subjectId').equals(subjectId).filter((t) => t.origin !== 'subject' && t.origin !== 'retry').toArray()
  const pool: { q: Question; lectureId: string }[] = []
  const seen = new Set<string>()
  for (const t of tests) {
    for (const q of t.questions) {
      const key = q.otazka.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const lid = t.questionLectures?.[q.id] ?? t.lectureId
      if (lid) pool.push({ q, lectureId: lid })
    }
  }
  const exam = shuffle(pool.filter((x) => x.q.skuskova), rnd)
  const other = shuffle(pool.filter((x) => !x.q.skuskova), rnd)
  const picked = (onlyExam ? exam : [...exam, ...other]).slice(0, count)
  if (!picked.length) return null
  const qLect: Record<string, string> = {}
  const questions = shuffle(picked, rnd).map((x, i) => {
    const id = `p${i + 1}`
    qLect[id] = x.lectureId
    return { ...x.q, id }
  })
  const test: StoredTest = {
    id: uid(),
    lectureId: null,
    subjectId,
    title: `Test z predmetu (${questions.length})`,
    questions,
    origin: 'subject',
    createdAt: Date.now(),
    questionLectures: qLect,
  }
  await db.tests.put(test)
  return test
}

/** Z ktorej prednášky je otázka. */
export function lectureOfQuestion(test: StoredTest, qid: string): string | null {
  return test.questionLectures?.[qid] ?? test.lectureId
}
