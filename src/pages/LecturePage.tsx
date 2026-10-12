import { useState } from 'react'
import { recorderState } from '../audio/session'
import { db, deleteLecture } from '../db/db'
import type { Lecture, Segment } from '../db/types'
import { fmtDate, fmtDuration, fmtTime } from '../lib/text'
import { continueWithPartial, queueState, retryTranscription, transcribeSkipped } from '../transcription/queue'
import { useLive, useOnline, useStore } from '../ui/hooks'
import { Progress, TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'
import { segProgress, StatusBadge } from '../ui/status'
import { toast, toastError } from '../ui/toast'
import { AudioTab } from './lecture/AudioTab'
import { CardsTab } from './lecture/CardsTab'
import { LectureActions } from './lecture/LectureActions'
import { MaterialTab } from './lecture/MaterialTab'
import { TestTab } from './lecture/TestTab'
import { TranscriptTab } from './lecture/TranscriptTab'

const TABS = [
  { key: 'material', label: 'Materiál' },
  { key: 'test', label: 'Test' },
  { key: 'karticky', label: 'Kartičky' },
  { key: 'prepis', label: 'Prepis' },
  { key: 'audio', label: 'Audio' },
] as const

function StatusCard({ lecture, segments, onTab }: { lecture: Lecture; segments: Segment[]; onTab: (t: string) => void }) {
  const q = useStore(queueState)
  const rec = useStore(recorderState)
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const p = segProgress(segments)
  const skipped = segments.filter((s) => s.status === 'skipped').length
  const done = segments.filter((s) => s.status === 'done').length

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toastError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (lecture.status === 'done') return null

  if (lecture.status === 'draft') {
    return (
      <div className="card">
        <b>Prednáška je prázdna.</b>
        <p className="small muted">Spusti nahrávanie, alebo ju zmaž a vytvor novú s importom či vloženým textom.</p>
        <a className="btn block red" href={lecture.source === 'live' ? `#/zivy/${lecture.id}` : `#/nahravat/${lecture.id}`}>
          ● {lecture.source === 'live' ? 'Živý prepis' : 'Nahrávať'}
        </a>
      </div>
    )
  }

  if (lecture.status === 'recording') {
    if (lecture.source === 'live') {
      return (
        <div className="card">
          <b>🧪 Živý prepis</b>
          <a className="btn block red" style={{ marginTop: 8 }} href={`#/zivy/${lecture.id}`}>
            Otvoriť živý prepis
          </a>
        </div>
      )
    }
    const live = rec.active && rec.lectureId === lecture.id && rec.phase !== 'interrupted'
    return (
      <div className="card">
        <b>{live ? '🔴 Práve sa nahráva' : '⚠️ Nahrávanie bolo prerušené'}</b>
        {p.total ? (
          <p className="small muted">
            Prepísané {p.done}/{p.total} úsekov – prepis beží už počas nahrávania.
          </p>
        ) : null}
        <a className="btn block red" href={`#/nahravat/${lecture.id}`}>
          {live ? 'Otvoriť nahrávanie' : 'Pokračovať alebo ukončiť nahrávanie'}
        </a>
      </div>
    )
  }

  if (lecture.status === 'transcribing') {
    const waiting = segments.find((s) => s.status === 'pending' && s.nextAttemptAt > Date.now())
    return (
      <div className="card">
        <div className="row">
          <b className="grow">
            Prepisuje sa {p.done}/{p.total}
          </b>
          {q.busy && q.lectureId === lecture.id ? <span className="spin" /> : null}
        </div>
        <div style={{ margin: '8px 0' }}>
          <Progress value={p.done} max={p.total || 1} />
        </div>
        {!online ? <div className="warn-box small">Si offline – úseky čakajú vo fronte a prepíšu sa, keď bude internet.</div> : null}
        {q.waiting === 'noKey' ? (
          <div className="warn-box small">
            Na prepis treba API kľúč. <a href="#/nastavenia">Zadaj ho v Nastaveniach</a> (Groq je zadarmo).
          </div>
        ) : null}
        {q.waiting === 'auth' ? (
          <div className="err small">
            {q.message} <a href="#/nastavenia">Otvoriť Nastavenia</a>
          </div>
        ) : null}
        {waiting ? (
          <div className="small muted">
            {waiting.error} Ďalší pokus o {fmtTime((waiting.nextAttemptAt - Date.now()) / 1000)}.
          </div>
        ) : null}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Prepis beží len pri otvorenej appke. Ak ju zatvoríš, pokračuje po ďalšom otvorení.
        </p>
      </div>
    )
  }

  if (lecture.status === 'transcribed') {
    return (
      <div className="card">
        <b>✅ Prepis je hotový</b>
        <p className="small muted">Ďalší krok: vytvor z prepisu učebný materiál a test.</p>
        <button className="btn block" onClick={() => onTab('material')}>
          ✨ Vytvoriť materiál
        </button>
      </div>
    )
  }

  if (lecture.status === 'generating') {
    return (
      <div className="card">
        <div className="row">
          <b className="grow">Vytvára sa materiál…</b>
          <span className="spin" />
        </div>
        <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => onTab('material')}>
          Zobraziť priebeh
        </button>
      </div>
    )
  }

  // chyba
  return (
    <div className="card">
      <b>⚠️ {lecture.errorStep === 'generate' ? 'Vytvorenie materiálu zlyhalo' : 'Prepis zlyhal'}</b>
      <div className="err small">{lecture.error ?? 'Neznáma chyba.'}</div>
      <div className="stack">
        {lecture.errorStep === 'generate' ? (
          <button className="btn block" onClick={() => onTab('material')}>
            Skúsiť znova
          </button>
        ) : (
          <>
            {segments.some((s) => s.status === 'error') ? (
              <button className="btn block" disabled={busy} onClick={() => run(() => retryTranscription(lecture.id))}>
                Skúsiť znova
              </button>
            ) : null}
            {skipped ? (
              <button className="btn block secondary" disabled={busy} onClick={() => run(() => transcribeSkipped(lecture.id))}>
                Prepísať aj tiché úseky ({skipped})
              </button>
            ) : null}
            {done ? (
              <button
                className="btn block ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await continueWithPartial(lecture.id)
                    toast('Pokračuje sa s prepísanou časťou')
                  })
                }
              >
                Pokračovať s tým, čo sa prepísalo ({done} úsekov)
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

export function LecturePage({ lectureId, tab, query }: { lectureId?: string; tab?: string; query: URLSearchParams }) {
  const id = lectureId ?? ''
  const lecture = useLive(() => db.lectures.get(id), [id])
  const subject = useLive(async () => (lecture ? db.subjects.get(lecture.subjectId) : undefined), [lecture?.subjectId])
  const segments = useLive(() => db.segments.where('lectureId').equals(id).toArray(), [id])
  const transcript = useLive(() => db.transcripts.get(id), [id])
  const marks = useLive(() => db.marks.where('lectureId').equals(id).toArray(), [id])
  const material = useLive(() => db.materials.get(id), [id])
  const [showActions, setShowActions] = useState(false)

  if (lecture === undefined) return null
  if (!lecture) {
    return (
      <>
        <TopBar title="Prednáška" back="/" />
        <div className="page empty">Prednáška neexistuje (možno bola zmazaná).</div>
      </>
    )
  }

  const active = tab ?? (material ? 'material' : transcript?.paragraphs.length ? 'prepis' : 'audio')
  const setTab = (t: string) => navigate(`/p/${id}/${t}`, true)
  const t = query.get('t')
  const focusT = t !== null ? Number(t) : undefined

  return (
    <>
      <TopBar
        title={lecture.title}
        back="/"
        right={
          <button className="back" onClick={() => setShowActions((v) => !v)} aria-label="Možnosti">
            ⋯
          </button>
        }
      />
      <div className="page">
        <div className="row wrap small muted" style={{ marginBottom: 10 }}>
          <a href={`#/predmet/${lecture.subjectId}`}>{subject?.name ?? 'Predmet'}</a>
          <span>· {fmtDate(lecture.createdAt)}</span>
          {lecture.durationSec ? <span>· {fmtDuration(lecture.durationSec)}</span> : null}
          <StatusBadge l={lecture} p={segProgress(segments ?? [])} />
        </div>
        {showActions ? (
          <LectureActions
            lecture={lecture}
            onDelete={async () => {
              if (!confirm(`Naozaj zmazať prednášku „${lecture.title}“ so všetkými dátami (audio, prepis, materiál, testy)?`)) return
              await deleteLecture(lecture.id)
              toast('Prednáška zmazaná')
              navigate('/', true)
            }}
          />
        ) : null}
        <StatusCard lecture={lecture} segments={segments ?? []} onTab={setTab} />
        <div className="tabs no-print">
          {TABS.map((x) => (
            <button key={x.key} className={active === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
        {active === 'material' ? <MaterialTab lecture={lecture} material={material ?? undefined} transcript={transcript ?? undefined} marks={marks ?? []} focusSection={query.get('s') ?? undefined} /> : null}
        {active === 'test' ? <TestTab lecture={lecture} material={material ?? undefined} /> : null}
        {active === 'karticky' ? <CardsTab lecture={lecture} /> : null}
        {active === 'prepis' ? <TranscriptTab lecture={lecture} transcript={transcript ?? undefined} marks={marks ?? []} focusT={focusT} /> : null}
        {active === 'audio' ? <AudioTab lecture={lecture} segments={segments ?? []} startT={focusT} /> : null}
      </div>
    </>
  )
}
