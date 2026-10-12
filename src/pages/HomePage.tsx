import { useState } from 'react'
import { db } from '../db/db'
import type { Lecture, Subject } from '../db/types'
import { loadDemo } from '../demo/loadDemo'
import { fmtDate, fmtDuration } from '../lib/text'
import { useLive } from '../ui/hooks'
import { Empty, TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'
import { segProgress, StatusBadge, type SegProgress } from '../ui/status'
import { toastError } from '../ui/toast'

interface Group {
  subject: Subject
  lectures: { l: Lecture; p: SegProgress }[]
}

export function HomePage() {
  const [busy, setBusy] = useState(false)
  const groups = useLive(async (): Promise<Group[]> => {
    const subjects = await db.subjects.orderBy('createdAt').toArray()
    const lectures = await db.lectures.orderBy('createdAt').reverse().toArray()
    const out: Group[] = []
    for (const s of subjects) {
      const ls = lectures.filter((l) => l.subjectId === s.id)
      const items = []
      for (const l of ls) {
        const segs = l.status === 'transcribing' ? await db.segments.where('lectureId').equals(l.id).toArray() : []
        items.push({ l, p: segProgress(segs) })
      }
      out.push({ subject: s, lectures: items })
    }
    // predmety s najnovšou prednáškou hore
    out.sort((a, b) => (b.lectures[0]?.l.createdAt ?? b.subject.createdAt) - (a.lectures[0]?.l.createdAt ?? a.subject.createdAt))
    return out
  }, [])

  const demo = async () => {
    setBusy(true)
    try {
      const id = await loadDemo()
      navigate(`/p/${id}`)
    } catch (e) {
      toastError(`Demo sa nepodarilo načítať: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar title="Prednášky" />
      <div className="page">
        <a className="btn block big" href="#/nova">
          ＋ Nová prednáška
        </a>
        {groups === undefined ? null : groups.length === 0 ? (
          <Empty ico="🎓" title="Zatiaľ žiadne prednášky">
            <p>Nahraj prednášku, importuj zvukový súbor alebo vlož hotový prepis. Appka z neho spraví materiál a test.</p>
            <button className="btn secondary" onClick={demo} disabled={busy}>
              {busy ? <span className="spin" /> : '▶︎'} Vyskúšať demo
            </button>
          </Empty>
        ) : (
          groups.map((g) => (
            <div key={g.subject.id}>
              <div className="section-title">
                <span className="grow">{g.subject.name}</span>
                <a href={`#/predmet/${g.subject.id}`} className="btn small ghost">
                  Predmet ›
                </a>
              </div>
              <div className="list">
                {g.lectures.length === 0 ? (
                  <div className="list-item muted">Žiadne prednášky</div>
                ) : (
                  g.lectures.map(({ l, p }) => (
                    <a
                      key={l.id}
                      className="list-item"
                      href={l.status === 'recording' && !l.interrupted ? `#/nahravat/${l.id}` : `#/p/${l.id}`}
                    >
                      <div className="grow">
                        <div className="title">{l.title}</div>
                        <div className="sub">
                          {fmtDate(l.createdAt)}
                          {l.durationSec > 0 ? ` · ${fmtDuration(l.durationSec)}` : ''}
                        </div>
                      </div>
                      <StatusBadge l={l} p={p} />
                      <span className="chev">›</span>
                    </a>
                  ))
                )}
              </div>
            </div>
          ))
        )}
        {groups && groups.length > 0 && !groups.some((g) => g.lectures.some((x) => x.l.source === 'demo')) ? (
          <p className="center small muted">
            <button className="btn small ghost" onClick={demo} disabled={busy}>
              Pridať ukážkovú prednášku
            </button>
          </p>
        ) : null}
      </div>
    </>
  )
}
