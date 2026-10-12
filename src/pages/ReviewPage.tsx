import { useMemo, useState } from 'react'
import { db } from '../db/db'
import type { Card } from '../db/types'
import { isDue } from '../exam/leitner'
import { fmtDate, plural } from '../lib/text'
import { CardReview } from '../ui/CardReview'
import { useLive } from '../ui/hooks'
import { Empty, TopBar } from '../ui/Layout'

/** Štatistiky: skóre v čase a slabé témy (podľa sekcií, kde sa najčastejšie chybuje). */
function Stats({ subjectId }: { subjectId: string }) {
  const data = useLive(async () => {
    const attempts = (subjectId ? await db.attempts.where('subjectId').equals(subjectId).toArray() : await db.attempts.toArray()).filter((a) => a.finishedAt)
    attempts.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    const tests = new Map((await db.tests.toArray()).map((t) => [t.id, t]))
    const materials = new Map((await db.materials.toArray()).map((m) => [m.lectureId, m]))
    const weak = new Map<string, { title: string; href: string; wrong: number; total: number }>()
    for (const a of attempts) {
      const t = tests.get(a.testId)
      if (!t) continue
      for (const q of t.questions) {
        const r = a.results[q.id]
        if (!r) continue
        const lid = t.questionLectures?.[q.id] ?? t.lectureId
        const sec = lid && q.zdroj.sekciaId ? materials.get(lid)?.data.sekcie.find((s) => s.id === q.zdroj.sekciaId) : undefined
        if (!sec || !lid) continue
        const key = `${lid}/${sec.id}`
        const w = weak.get(key) ?? { title: sec.nadpis, href: `#/p/${lid}/material?s=${encodeURIComponent(sec.id)}`, wrong: 0, total: 0 }
        w.total++
        if (!r.correct) w.wrong++
        weak.set(key, w)
      }
    }
    const weakList = [...weak.values()].filter((w) => w.wrong > 0).sort((a, b) => b.wrong / b.total - a.wrong / a.total || b.wrong - a.wrong).slice(0, 5)
    return { attempts: attempts.slice(-10), weakList, count: attempts.length }
  }, [subjectId])
  if (!data || !data.count) return null
  const avg = Math.round((data.attempts.reduce((s, a) => s + (a.max ? a.score / a.max : 0), 0) / data.attempts.length) * 100)
  return (
    <div className="card">
      <h3>📈 Štatistiky</h3>
      <div className="small muted">
        {data.count} {plural(data.count, 'test', 'testy', 'testov')} · priemer posledných {data.attempts.length}: <b>{avg} %</b>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 4, height: 80, marginTop: 10 }}>
        {data.attempts.map((a) => {
          const pct = a.max ? Math.round((a.score / a.max) * 100) : 0
          return (
            <a
              key={a.id}
              href={`#/vysledok/${a.id}`}
              title={`${fmtDate(a.finishedAt!)} – ${pct} %`}
              style={{
                flex: 1,
                height: `${Math.max(6, pct)}%`,
                background: pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)',
                borderRadius: 4,
              }}
            />
          )
        })}
      </div>
      <div className="small muted">Skóre posledných testov (zľava najstaršie)</div>
      {data.weakList.length ? (
        <>
          <div className="section-title" style={{ marginLeft: 0 }}>
            Slabé témy
          </div>
          {data.weakList.map((w, i) => (
            <a key={i} className="list-item" href={w.href} style={{ padding: '8px 0', minHeight: 0 }}>
              <span className="grow">{w.title}</span>
              <span className="badge skuska">
                {w.wrong}/{w.total} chýb
              </span>
            </a>
          ))}
        </>
      ) : null}
    </div>
  )
}

export function ReviewPage() {
  const subjects = useLive(() => db.subjects.orderBy('createdAt').toArray(), [])
  const cards = useLive(() => db.cards.toArray(), [])
  const [subjectId, setSubjectId] = useState('')
  const [session, setSession] = useState<Card[] | null>(null)
  const filtered = useMemo(() => (cards ?? []).filter((c) => !subjectId || c.subjectId === subjectId), [cards, subjectId])
  const due = filtered.filter((c) => isDue(c))

  if (session) {
    return (
      <>
        <TopBar title="Opakovanie" />
        <div className="page">
          <CardReview cards={session} onDone={() => setSession(null)} showSource />
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Opakovanie" />
      <div className="page">
        {(subjects ?? []).length > 1 ? (
          <label className="field">
            <span>Predmet</span>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Všetky predmety</option>
              {(subjects ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!filtered.length ? (
          <Empty ico="🃏" title="Zatiaľ žiadne kartičky">
            <p>Kartičky vzniknú automaticky spolu s materiálom z prednášky.</p>
          </Empty>
        ) : (
          <div className="card">
            <h3>🃏 Kartičky</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              Na opakovanie teraz: <b>{due.length}</b> z {filtered.length}. Čo vieš, sa vráti o 1, 2, 4, 8 a 16 dní (Leitnerov systém).
            </p>
            <div className="btn-row">
              <button className="btn" disabled={!due.length} onClick={() => setSession(due)}>
                🔁 Opakovať ({due.length})
              </button>
              <button className="btn secondary" disabled={!filtered.some((c) => c.skuskova)} onClick={() => setSession(filtered.filter((c) => c.skuskova))}>
                Len skúškové
              </button>
            </div>
          </div>
        )}

        {(subjects ?? []).length ? (
          <>
            <div className="section-title">Príprava na skúšku podľa predmetu</div>
            <div className="list">
              {(subjects ?? [])
                .filter((s) => !subjectId || s.id === subjectId)
                .map((s) => (
                  <div key={s.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                    <div className="grow title">{s.name}</div>
                    <a className="btn small secondary" href={`#/predmet/${s.id}/skuska`}>
                      🔴 Na skúške
                    </a>
                    <a className="btn small secondary" href={`#/predmet/${s.id}/test`}>
                      📝 Test
                    </a>
                  </div>
                ))}
            </div>
          </>
        ) : null}

        <Stats subjectId={subjectId} />
      </div>
    </>
  )
}
