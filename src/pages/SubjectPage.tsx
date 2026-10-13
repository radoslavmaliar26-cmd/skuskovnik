import { useEffect, useState } from 'react'
import { abortRecording } from '../audio/session'
import { db, deleteLecture } from '../db/db'
import type { Lang, Subject } from '../db/types'
import { buildSubjectTest, createRetryTest } from '../exam/tests'
import { fmtDate, fmtDateTime, fmtDuration, parseTime, plural } from '../lib/text'
import { useLive } from '../ui/hooks'
import { Empty, TopBar } from '../ui/Layout'
import { Md } from '../ui/Markdown'
import { navigate } from '../ui/router'
import { StatusBadge } from '../ui/status'
import { toast } from '../ui/toast'
import { ExamList } from './lecture/MaterialTab'

const TABS = [
  { key: 'prednasky', label: 'Prednášky' },
  { key: 'skuska', label: 'Bude na skúške' },
  { key: 'test', label: 'Test' },
  { key: 'nastavenia', label: 'Nastavenia' },
] as const

function SubjectSettings({ subject }: { subject: Subject }) {
  const [name, setName] = useState(subject.name)
  const [glossary, setGlossary] = useState(subject.glossary)
  useEffect(() => {
    setName(subject.name)
    setGlossary(subject.glossary)
  }, [subject.id, subject.name, subject.glossary])
  const save = async (patch: Partial<Subject>) => {
    await db.subjects.update(subject.id, patch)
    toast('Uložené')
  }
  return (
    <div className="card">
      <label className="field">
        <span>Názov predmetu</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== subject.name && void save({ name: name.trim() })} />
      </label>
      <label className="field">
        <span>Jazyk prednášok (pre prepis)</span>
        <select value={subject.language} onChange={(e) => void save({ language: e.target.value as Lang })}>
          <option value="sk">Slovenčina</option>
          <option value="cs">Čeština</option>
          <option value="en">Angličtina</option>
          <option value="auto">Rozpoznať automaticky</option>
        </select>
      </label>
      <label className="field">
        <span>Slovník pojmov</span>
        <textarea
          value={glossary}
          onChange={(e) => setGlossary(e.target.value)}
          onBlur={() => glossary !== subject.glossary && void save({ glossary })}
          placeholder="napr. Hookov zákon, Youngov modul, Poissonovo číslo, Mohrova kružnica"
          style={{ minHeight: 90 }}
        />
        <small>Odborné termíny a mená oddelené čiarkou – pomôžu prepisu správne rozpoznať slová (max. ~300 znakov sa použije).</small>
      </label>
    </div>
  )
}

export function SubjectPage({ subjectId, tab }: { subjectId?: string; tab?: string }) {
  const id = subjectId ?? ''
  const subject = useLive(() => db.subjects.get(id), [id])
  const lectures = useLive(() => db.lectures.where('subjectId').equals(id).reverse().sortBy('createdAt'), [id])
  const materials = useLive(async () => {
    const ls = await db.lectures.where('subjectId').equals(id).sortBy('createdAt')
    const out = []
    for (const l of ls) {
      const m = await db.materials.get(l.id)
      if (m) out.push({ lecture: l, material: m })
    }
    return out
  }, [id])
  const tests = useLive(() => db.tests.where('subjectId').equals(id).filter((t) => t.lectureId === null).toArray(), [id])
  const attempts = useLive(() => db.attempts.where('subjectId').equals(id).toArray(), [id])
  const [count, setCount] = useState(20)
  const [onlyExam, setOnlyExam] = useState(false)

  if (subject === undefined) return null
  if (!subject) {
    return (
      <>
        <TopBar title="Predmet" back="/" />
        <div className="page empty">Predmet neexistuje.</div>
      </>
    )
  }
  const active = tab ?? 'prednasky'
  const setTab = (t: string) => navigate(`/predmet/${id}/${t}`, true)
  const questionCount = (materials ?? []).reduce((s, m) => s + m.material.data.test.length, 0)

  const startSubjectTest = async () => {
    const t = await buildSubjectTest(id, count, onlyExam)
    if (t) navigate(`/test/${t.id}`)
    else toast('V predmete zatiaľ nie sú žiadne otázky – najprv vytvor materiál k prednáškam.')
  }

  const orgAll = (materials ?? []).flatMap((m) => m.material.data.organizacne.map((o) => ({ ...o, lecture: m.lecture })))

  return (
    <>
      <TopBar title={subject.name} back="/" />
      <div className="page">
        <div className="tabs">
          {TABS.map((x) => (
            <button key={x.key} className={active === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
              {x.label}
            </button>
          ))}
        </div>

        {active === 'prednasky' ? (
          <>
            <a className="btn block" href={`#/nova?predmet=${id}`}>
              ＋ Nová prednáška
            </a>
            <div className="spacer" />
            {(lectures ?? []).length ? (
              <div className="list">
                {(lectures ?? []).map((l) => (
                  <a key={l.id} className="list-item" href={`#/p/${l.id}`}>
                    <div className="grow">
                      <div className="title">{l.title}</div>
                      <div className="sub">
                        {fmtDate(l.createdAt)}
                        {l.durationSec ? ` · ${fmtDuration(l.durationSec)}` : ''}
                      </div>
                    </div>
                    <StatusBadge l={l} />
                    <span className="chev">›</span>
                  </a>
                ))}
              </div>
            ) : (
              <Empty ico="📭" title="Žiadne prednášky" />
            )}
          </>
        ) : null}

        {active === 'skuska' ? (
          <>
            <p className="small muted">Všetko, o čom vyučujúci povedal, že bude na skúške – zo všetkých prednášok predmetu.</p>
            {orgAll.length ? (
              <div className="card" style={{ borderTop: '4px solid var(--purple)' }}>
                <h3>📅 Termíny a organizačné</h3>
                {orgAll.map((o, i) => (
                  <div key={i} className="callout organizacne">
                    {o.datum ? <span className="badge organizacne">📅 {o.datum}</span> : null} <Md text={o.text} inline />
                    <div className="meta">
                      {o.lecture.title}
                      {parseTime(o.cas) !== null ? (
                        <>
                          {' '}
                          · <a href={`#/p/${o.lecture.id}/prepis?t=${Math.floor(parseTime(o.cas)!)}`}>{o.cas}</a>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {(materials ?? []).length ? (
              (materials ?? []).map(({ lecture, material }) => (
                <div key={lecture.id} className="card">
                  <div className="row">
                    <h3 className="grow">{lecture.title}</h3>
                    <a className="small" href={`#/p/${lecture.id}/material`}>
                      Materiál ›
                    </a>
                  </div>
                  <ExamList items={material.data.naSkuske} lectureId={lecture.id} />
                </div>
              ))
            ) : (
              <Empty ico="📝" title="Zatiaľ žiadne materiály" />
            )}
          </>
        ) : null}

        {active === 'test' ? (
          <>
            <div className="card">
              <h3>Test z celého predmetu</h3>
              <p className="small muted">
                Poskladá sa z otázok všetkých prednášok ({questionCount} {plural(questionCount, 'otázka', 'otázky', 'otázok')}), skúškové prednostne. Netreba internet.
              </p>
              <label className="field">
                <span>Počet otázok</span>
                <div className="seg">
                  {[10, 20, 30].map((n) => (
                    <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </label>
              <label className="check">
                <input type="checkbox" checked={onlyExam} onChange={(e) => setOnlyExam(e.target.checked)} />
                Len skúškové témy
              </label>
              <button className="btn block" disabled={!questionCount} onClick={() => void startSubjectTest()}>
                ▶︎ Spustiť test
              </button>
              <div className="spacer" />
              <button
                className="btn block secondary"
                onClick={async () => {
                  const t = await createRetryTest({ subjectId: id })
                  if (t) navigate(`/test/${t.id}`)
                  else toast('Žiadne chybné odpovede na zopakovanie 🎉')
                }}
              >
                🔁 Zopakovať chybné z celého predmetu
              </button>
            </div>
            {(attempts ?? []).filter((a) => a.finishedAt).length ? (
              <>
                <div className="section-title">Posledné výsledky v predmete</div>
                <div className="list">
                  {(attempts ?? [])
                    .filter((a) => a.finishedAt)
                    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
                    .slice(0, 10)
                    .map((a) => (
                      <a key={a.id} className="list-item" href={`#/vysledok/${a.id}`}>
                        <div className="grow">
                          <div className="title">{(tests ?? []).find((t) => t.id === a.testId)?.title ?? 'Test z prednášky'}</div>
                          <div className="sub">{fmtDateTime(a.finishedAt!)}</div>
                        </div>
                        <b>{a.max ? Math.round((a.score / a.max) * 100) : 0} %</b>
                      </a>
                    ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {active === 'nastavenia' ? (
          <>
            <SubjectSettings subject={subject} />
            <button
              className="btn block danger"
              onClick={async () => {
                const n = (lectures ?? []).length
                if (!confirm(n ? `Zmazať predmet aj s ${n} ${plural(n, 'prednáškou', 'prednáškami', 'prednáškami')} a všetkými dátami?` : 'Zmazať predmet?')) return
                for (const l of lectures ?? []) {
                  await abortRecording(l.id)
                  await deleteLecture(l.id)
                }
                await db.tests.where('subjectId').equals(id).delete()
                await db.attempts.where('subjectId').equals(id).delete()
                await db.subjects.delete(id)
                toast('Predmet zmazaný')
                navigate('/', true)
              }}
            >
              🗑 Zmazať predmet
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}
