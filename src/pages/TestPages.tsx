import { useEffect, useMemo, useState } from 'react'
import { gradeOpenAnswer } from '../ai/jobs'
import { QUESTION_TYPE_LABELS, type Question } from '../ai/schema'
import { db } from '../db/db'
import type { Answer, Attempt, QuestionResult, StoredTest } from '../db/types'
import { answerText, correctAnswerText, isAnswered, scoreQuestion, summarize } from '../exam/scoring'
import { createRetryTest, finishAttempt, lectureOfQuestion, saveAnswer, startAttempt } from '../exam/tests'
import { fmtDateTime, parseTime } from '../lib/text'
import { useLive, useSettings } from '../ui/hooks'
import { Progress, TopBar } from '../ui/Layout'
import { Md } from '../ui/Markdown'
import { navigate } from '../ui/router'
import { toastError } from '../ui/toast'

/** Odkazy na zdroj otázky v materiáli / prepise / audiu. */
export function SourceLinks({ test, q }: { test: StoredTest; q: Question }) {
  const lid = lectureOfQuestion(test, q.id)
  if (!lid) return null
  const t = parseTime(q.zdroj.cas)
  return (
    <div className="row wrap small" style={{ marginTop: 8 }}>
      {q.zdroj.sekciaId ? (
        <a className="btn small ghost" href={`#/p/${lid}/material?s=${encodeURIComponent(q.zdroj.sekciaId)}`}>
          📖 Ukázať v materiáli
        </a>
      ) : null}
      {t !== null ? (
        <>
          <a className="btn small ghost" href={`#/p/${lid}/prepis?t=${Math.floor(t)}`}>
            📝 V prepise {q.zdroj.cas}
          </a>
          <a className="btn small ghost" href={`#/p/${lid}/audio?t=${Math.floor(t)}`}>
            ▶︎ Prehrať od {q.zdroj.cas}
          </a>
        </>
      ) : null}
      {q.zdroj.citat ? (
        <div className="quote" style={{ width: '100%' }}>
          „{q.zdroj.citat}“{q.zdroj.overene === false ? ' (citát sa v prepise nenašiel)' : ''}
        </div>
      ) : null}
    </div>
  )
}

function QuestionInput({
  q,
  answer,
  setAnswer,
  locked,
  showCorrect,
}: {
  q: Question
  answer: Answer | undefined
  setAnswer: (a: Answer) => void
  locked: boolean
  showCorrect: boolean
}) {
  if (q.typ === 'jedna' || q.typ === 'viac') {
    const multi = q.typ === 'viac'
    const sel = multi ? new Set(Array.isArray(answer) ? answer : []) : new Set(typeof answer === 'number' ? [answer] : [])
    const right = new Set(multi ? q.spravne : [q.spravne])
    return (
      <div>
        {multi ? <p className="small muted">Vyber všetky správne možnosti.</p> : null}
        {q.moznosti.map((o, i) => {
          const isSel = sel.has(i)
          const cls = showCorrect ? (right.has(i) ? 'right' : isSel ? 'wrong' : '') : isSel ? 'sel' : ''
          return (
            <button
              key={i}
              className={`opt ${multi ? 'multi' : ''} ${cls}`}
              disabled={locked}
              onClick={() => {
                if (multi) {
                  const next = new Set(sel)
                  if (next.has(i)) next.delete(i)
                  else next.add(i)
                  setAnswer([...next].sort((a, b) => a - b))
                } else setAnswer(i)
              }}
            >
              <span className="mark">{showCorrect && right.has(i) ? '✓' : isSel ? (multi ? '✓' : '●') : String.fromCharCode(65 + i)}</span>
              <span className="grow">
                <Md text={o} inline />
              </span>
            </button>
          )
        })}
      </div>
    )
  }
  if (q.typ === 'pravdaNepravda') {
    return (
      <div className="btn-row">
        {[true, false].map((v) => {
          const isSel = answer === v
          const cls = showCorrect ? (q.spravne === v ? 'right' : isSel ? 'wrong' : '') : isSel ? 'sel' : ''
          return (
            <button key={String(v)} className={`opt ${cls}`} style={{ justifyContent: 'center' }} disabled={locked} onClick={() => setAnswer(v)}>
              <b>{v ? 'Pravda' : 'Nepravda'}</b>
            </button>
          )
        })}
      </div>
    )
  }
  if (q.typ === 'doplnenie' || q.typ === 'vypocet') {
    return (
      <div className="row">
        <input
          type="text"
          inputMode={q.typ === 'vypocet' ? 'decimal' : 'text'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={typeof answer === 'string' ? answer : ''}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={locked}
          placeholder={q.typ === 'vypocet' ? 'Výsledok' : 'Tvoja odpoveď'}
        />
        {q.typ === 'vypocet' && q.jednotka ? <b>{q.jednotka}</b> : null}
      </div>
    )
  }
  // otvorená
  return (
    <textarea
      value={typeof answer === 'string' ? answer : ''}
      onChange={(e) => setAnswer(e.target.value)}
      disabled={locked}
      placeholder="Napíš odpoveď (nepovinné – môžeš ju povedať aj nahlas a potom sa ohodnotiť)"
    />
  )
}

export function TestRunPage({ testId }: { testId?: string }) {
  const settings = useSettings()
  const [test, setTest] = useState<StoredTest | null | undefined>(undefined)
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [idx, setIdx] = useState(0)
  const [answer, setAnswer] = useState<Answer | undefined>(undefined)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [result, setResult] = useState<QuestionResult | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiFeedback, setAiFeedback] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const t = await db.tests.get(testId ?? '')
      if (!alive) return
      setTest(t ?? null)
      if (!t) return
      const a = await startAttempt(t.id)
      if (!alive) return
      setAttempt(a)
      const first = t.questions.findIndex((q) => !a.results[q.id])
      setIdx(first < 0 ? t.questions.length - 1 : first)
    })()
    return () => {
      alive = false
    }
  }, [testId])

  const q = test?.questions[idx]

  if (test === undefined || !settings) return null
  if (!test) {
    return (
      <>
        <TopBar title="Test" back />
        <div className="page empty">Test neexistuje.</div>
      </>
    )
  }
  if (!attempt || !q) return null

  const instant = settings.instantFeedback
  const total = test.questions.length
  const isLast = idx >= total - 1
  const canAi = settings.aiGrading && !!settings.keys.anthropic.trim() && typeof answer === 'string' && answer.trim().length > 3

  const resetQ = () => {
    setAnswer(undefined)
    setChecked(false)
    setRevealed(false)
    setResult(null)
    setAiFeedback(null)
  }

  const commit = async (r: QuestionResult) => {
    await saveAnswer(attempt.id, q.id, answer ?? null, r)
    setAttempt((a) => (a ? { ...a, answers: { ...a.answers, [q.id]: answer ?? null }, results: { ...a.results, [q.id]: r } } : a))
  }

  const check = async () => {
    const r = scoreQuestion(q, answer)
    setResult(r)
    setChecked(true)
    await commit(r)
  }

  const finish = async () => {
    const done = await finishAttempt(attempt.id)
    if (done) navigate(`/vysledok/${done.id}`, true)
  }

  const next = async () => {
    if (!checked && q.typ !== 'otvorena') {
      // bez okamžitej spätnej väzby: ulož a pokračuj
      await commit(scoreQuestion(q, answer))
    }
    if (isLast) {
      await finish()
      return
    }
    setIdx(idx + 1)
    resetQ()
    window.scrollTo(0, 0)
  }

  const selfGrade = async (g: NonNullable<QuestionResult['selfGrade']>) => {
    const r = { ...scoreQuestion(q, answer, { selfGrade: g }), aiFeedback: aiFeedback ?? undefined }
    setResult(r)
    setChecked(true)
    await commit(r)
  }

  const aiGrade = async () => {
    if (q.typ !== 'otvorena') return
    setAiBusy(true)
    try {
      const g = await gradeOpenAnswer(q, String(answer ?? ''))
      const fb = `${g.hodnotenie}${g.chybajuce.length ? ` Chýba: ${g.chybajuce.join('; ')}.` : ''}`
      setAiFeedback(fb)
      const r = { ...scoreQuestion(q, answer, { aiScore: g.skore }), aiFeedback: fb }
      setResult(r)
      setRevealed(true)
      setChecked(true)
      await commit(r)
    } catch (e) {
      toastError((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  const answered = isAnswered(q, answer)

  return (
    <>
      <TopBar
        title={test.title}
        back
        right={
          <button
            className="back"
            onClick={() => {
              if (confirm('Ukončiť test a vyhodnotiť zodpovedané otázky?')) void finish()
            }}
          >
            Ukončiť
          </button>
        }
      />
      <div className="page">
        <div className="row small muted" style={{ marginBottom: 6 }}>
          <span className="grow">
            Otázka {idx + 1} z {total}
          </span>
          <span className="badge muted">{QUESTION_TYPE_LABELS[q.typ]}</span>
          {q.skuskova ? <span className="badge skuska">🔴 skúšková</span> : null}
        </div>
        <Progress value={idx + (checked ? 1 : 0)} max={total} />
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            <Md text={q.otazka} />
          </div>
        </div>

        <QuestionInput q={q} answer={answer} setAnswer={setAnswer} locked={checked} showCorrect={checked && instant} />

        {q.typ === 'otvorena' ? (
          <div className="stack" style={{ marginTop: 10 }}>
            {!revealed ? (
              <div className="btn-row">
                <button className="btn secondary" onClick={() => setRevealed(true)}>
                  Ukázať vzorovú odpoveď
                </button>
                {canAi ? (
                  <button className="btn" onClick={() => void aiGrade()} disabled={aiBusy}>
                    {aiBusy ? <span className="spin" /> : '🤖'} Ohodnotiť AI
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="card">
                <b>Vzorová odpoveď</b>
                <Md text={q.vzorovaOdpoved} />
                {q.kluceveBody.length ? (
                  <>
                    <b className="small">Kľúčové body</b>
                    <ul className="small" style={{ margin: '4px 0', paddingLeft: '1.2em' }}>
                      {q.kluceveBody.map((k, i) => (
                        <li key={i}>
                          <Md text={k} inline />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {aiFeedback ? <div className="info-box small">🤖 {aiFeedback}</div> : null}
                <div className="small muted" style={{ marginTop: 8 }}>
                  Ako si odpovedal?
                </div>
                <div className="btn-row" style={{ marginTop: 6 }}>
                  {(['vedel', 'ciastocne', 'nevedel'] as const).map((g) => (
                    <button
                      key={g}
                      className={`btn small ${result?.selfGrade === g ? '' : 'ghost'}`}
                      onClick={() => void selfGrade(g)}
                    >
                      {g === 'vedel' ? '✅ Vedel' : g === 'ciastocne' ? '◐ Čiastočne' : '❌ Nevedel'}
                    </button>
                  ))}
                </div>
                <SourceLinks test={test} q={q} />
              </div>
            )}
          </div>
        ) : null}

        {checked && instant && q.typ !== 'otvorena' && result ? (
          <div className={`card ${result.correct ? '' : ''}`} style={{ marginTop: 12, borderLeft: `4px solid ${result.correct ? 'var(--green)' : 'var(--red)'}` }}>
            <b>{result.correct ? '✅ Správne' : result.score > 0 ? `◐ Čiastočne (${String(result.score).replace('.', ',')} b.)` : '❌ Nesprávne'}</b>
            {!result.correct ? (
              <div className="small" style={{ marginTop: 4 }}>
                Správne: <b>{correctAnswerText(q)}</b>
              </div>
            ) : null}
            {q.vysvetlenie ? (
              <div className="small" style={{ marginTop: 6 }}>
                <Md text={q.vysvetlenie} />
              </div>
            ) : null}
            {q.typ === 'vypocet' && q.vzorovaOdpoved ? (
              <div className="small">
                <Md text={`**Postup:** ${q.vzorovaOdpoved}`} />
              </div>
            ) : null}
            <SourceLinks test={test} q={q} />
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          {q.typ === 'otvorena' ? (
            <button className="btn block" disabled={!checked} onClick={() => void next()}>
              {isLast ? 'Vyhodnotiť test' : 'Ďalej →'}
            </button>
          ) : instant && !checked ? (
            <button className="btn block" disabled={!answered} onClick={() => void check()}>
              Skontrolovať
            </button>
          ) : (
            <button className="btn block" disabled={!answered && !checked} onClick={() => void next()}>
              {isLast ? 'Vyhodnotiť test' : 'Ďalej →'}
            </button>
          )}
          {!checked && q.typ !== 'otvorena' ? (
            <button
              className="btn block ghost"
              style={{ marginTop: 8 }}
              onClick={async () => {
                const r = scoreQuestion(q, null)
                await saveAnswer(attempt.id, q.id, null, r)
                if (isLast) await finish()
                else {
                  setIdx(idx + 1)
                  resetQ()
                }
              }}
            >
              Neviem – preskočiť
            </button>
          ) : null}
        </div>
      </div>
    </>
  )
}

export function ResultPage({ attemptId }: { attemptId?: string }) {
  const attempt = useLive(() => db.attempts.get(attemptId ?? ''), [attemptId])
  const test = useLive(async () => (attempt ? db.tests.get(attempt.testId) : undefined), [attempt?.testId])
  const [busy, setBusy] = useState(false)
  const stats = useMemo(() => (attempt && test ? summarize(test.questions, attempt.results) : null), [attempt, test])

  if (attempt === undefined) return null
  if (!attempt || !test || !stats) {
    return (
      <>
        <TopBar title="Výsledok" back />
        <div className="page empty">Výsledok sa nenašiel.</div>
      </>
    )
  }
  const pct = stats.max ? Math.round((stats.score / stats.max) * 100) : 0
  const wrong = test.questions.filter((q) => !attempt.results[q.id]?.correct)
  const backHref = test.lectureId ? `#/p/${test.lectureId}/test` : `#/predmet/${test.subjectId}`

  const retry = async () => {
    setBusy(true)
    try {
      const t = await createRetryTest({ attemptId: attempt.id })
      if (t) navigate(`/test/${t.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar title="Výsledok testu" back={backHref.slice(1)} />
      <div className="page">
        <div className="card center">
          <div className="small muted">{test.title} · {fmtDateTime(attempt.finishedAt ?? attempt.startedAt)}</div>
          <div className="score-big" style={{ color: pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)' }}>
            {pct} %
          </div>
          <div>
            {String(stats.score).replace('.', ',')} / {stats.max} bodov
          </div>
          {stats.examMax ? (
            <div className="small muted">
              Skúškové otázky: {String(stats.examScore).replace('.', ',')} / {stats.examMax}
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <Progress value={stats.score} max={stats.max} />
          </div>
        </div>
        <div className="btn-row">
          {wrong.length ? (
            <button className="btn" onClick={() => void retry()} disabled={busy}>
              🔁 Zopakovať chybné ({wrong.length})
            </button>
          ) : null}
          <a className="btn secondary" href={backHref}>
            {test.lectureId ? 'Späť na testy' : 'Späť na predmet'}
          </a>
        </div>

        <div className="section-title">{wrong.length ? `Chyby a neisté odpovede (${wrong.length})` : 'Všetko správne 🎉'}</div>
        {wrong.map((q) => {
          const r = attempt.results[q.id]
          return (
            <div key={q.id} className="card" style={{ borderLeft: `4px solid ${r && r.score > 0 ? 'var(--orange)' : 'var(--red)'}` }}>
              <div className="row small muted" style={{ marginBottom: 4 }}>
                <span className="grow">{QUESTION_TYPE_LABELS[q.typ]}</span>
                {q.skuskova ? <span className="badge skuska">🔴 skúšková</span> : null}
              </div>
              <b>
                <Md text={q.otazka} />
              </b>
              <div className="small" style={{ marginTop: 6 }}>
                Tvoja odpoveď: <span style={{ color: 'var(--red)' }}>{q.typ === 'otvorena' ? `${answerText(q, attempt.answers[q.id])} (${r?.selfGrade === 'ciastocne' ? 'čiastočne' : r?.selfGrade === 'nevedel' ? 'nevedel' : '—'})` : answerText(q, attempt.answers[q.id])}</span>
              </div>
              <div className="small">
                Správne: <b><Md text={correctAnswerText(q)} inline /></b>
              </div>
              {q.vysvetlenie ? (
                <div className="small muted" style={{ marginTop: 6 }}>
                  <Md text={q.vysvetlenie} />
                </div>
              ) : null}
              {r?.aiFeedback ? <div className="info-box small">🤖 {r.aiFeedback}</div> : null}
              <SourceLinks test={test} q={q} />
            </div>
          )
        })}
      </div>
    </>
  )
}
