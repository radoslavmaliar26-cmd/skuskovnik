import { useEffect, useState } from 'react'
import {
  addMark, finishInterrupted, pauseRecording, recorderState, recordingSupported, resumeRecording, startRecording, stopRecording,
} from '../audio/session'
import { db, saveSettings } from '../db/db'
import { fmtTime } from '../lib/text'
import { useLive, useOnline, useSettings, useStore } from '../ui/hooks'
import { TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'
import { segProgress } from '../ui/status'
import { PhotoButton } from '../ui/Photos'
import { toast } from '../ui/toast'

export function RecordPage({ lectureId }: { lectureId?: string }) {
  const rec = useStore(recorderState)
  const settings = useSettings()
  const online = useOnline()
  const lecture = useLive(() => db.lectures.get(lectureId ?? ''), [lectureId])
  const segs = useLive(() => db.segments.where('lectureId').equals(lectureId ?? '').toArray(), [lectureId])
  const marks = useLive(() => db.marks.where('lectureId').equals(lectureId ?? '').toArray(), [lectureId])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [black, setBlack] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const mine = rec.lectureId === lectureId && rec.active
  const phase = mine ? rec.phase : 'idle'
  const otherActive = rec.active && rec.lectureId !== lectureId && rec.phase !== 'interrupted'

  useEffect(() => {
    if (!rec.lastMark || !mine) return
    const label = rec.lastMark.type === 'exam' ? '🎯 Bude na skúške' : '⭐ Dôležité'
    setFlash(rec.lastMark.type)
    toast(`${label} – označené v ${fmtTime(rec.lastMark.t)}`, 'info', 1800)
    const t = setTimeout(() => setFlash(null), 500)
    return () => clearTimeout(t)
  }, [rec.lastMark, mine])

  useEffect(() => {
    if (settings?.blackScreen && phase === 'recording') setBlack(true)
    // len pri prvom spustení nahrávania
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'recording'])

  if (!lectureId) return null
  if (lecture === undefined) return null
  if (!lecture) {
    return (
      <>
        <TopBar title="Nahrávanie" back />
        <div className="page">Prednáška neexistuje.</div>
      </>
    )
  }

  const unsupported = recordingSupported()
  const hasSegments = (segs ?? []).length > 0
  const interrupted = phase === 'interrupted' || (!mine && lecture.status === 'recording' && (lecture.interrupted || hasSegments))
  const prog = segProgress(segs ?? [])
  const stars = (marks ?? []).filter((m) => m.type === 'star').length
  const exams = (marks ?? []).filter((m) => m.type === 'exam').length

  const act = async (fn: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const start = () => act(() => startRecording(lectureId, { gapBefore: hasSegments }))
  const stop = () =>
    act(async () => {
      if (!confirm('Ukončiť nahrávanie? Nahrávka sa začne prepisovať.')) return
      await stopRecording()
      navigate(`/p/${lectureId}`, true)
    })
  const finishWithout = () =>
    act(async () => {
      await finishInterrupted(lectureId)
      navigate(`/p/${lectureId}`, true)
    })

  const timer = phase === 'idle' ? lecture.durationSec : rec.elapsedSec

  if (black && phase === 'recording') {
    return (
      <div className="blackout" onClick={() => setBlack(false)}>
        <div style={{ fontSize: '1.4rem' }}>
          <span className="rec-dot" style={{ opacity: 0.4 }} />
          {fmtTime(rec.elapsedSec)}
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          Ťukni pre ovládanie
        </div>
      </div>
    )
  }

  return (
    <>
      <TopBar title={lecture.title} back={phase === 'idle' || interrupted ? '/' : undefined} />
      <div className="page">
        {unsupported ? <div className="err">{unsupported}</div> : null}
        {error ? <div className="err">{error}</div> : null}
        {otherActive ? <div className="warn-box">Práve sa nahráva iná prednáška. Najprv ju ukonči.</div> : null}

        <div className="card center">
          <div className="small muted">
            {phase === 'recording' ? (
              <>
                <span className="rec-dot" />
                Nahráva sa
              </>
            ) : phase === 'paused' ? (
              '⏸ Pozastavené'
            ) : phase === 'starting' ? (
              'Spúšťam mikrofón…'
            ) : phase === 'stopping' ? (
              'Ukladám…'
            ) : interrupted ? (
              '⚠️ Nahrávanie bolo prerušené'
            ) : (
              'Pripravené na nahrávanie'
            )}
          </div>
          <div className="rec-timer">{fmtTime(timer)}</div>
          {phase === 'recording' || phase === 'paused' ? (
            <>
              <div className="meter" aria-label="Hlasitosť">
                <div style={{ width: `${Math.round(rec.level * 100)}%` }} />
              </div>
              <div className="small muted">
                {rec.level < 0.12 && phase === 'recording' ? 'Ticho – mikrofón počúva' : 'Mikrofón zachytáva zvuk'} · úsek {rec.segmentIndex + 1}
                {prog.total ? ` · prepísané ${prog.done}/${prog.total}` : ''}
                {!online ? ' · offline (prepis počká)' : ''}
              </div>
            </>
          ) : null}
        </div>

        {phase === 'idle' && !interrupted ? (
          <>
            <button className="btn block big red" onClick={start} disabled={busy || !!unsupported || otherActive}>
              {busy ? <span className="spin" /> : '●'} Začať nahrávať
            </button>
            <div className="card flat small" style={{ marginTop: 14 }}>
              <b>Tipy:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: '1.2em' }}>
                <li>Appku nechaj otvorenú na popredí – iOS pri zamknutí alebo odchode do inej appky nahrávanie preruší.</li>
                <li>Ideálne daj mobil na nabíjačku a čo najbližšie k vyučujúcemu.</li>
                <li>Počas prednášky ťukaj na ⭐ a 🎯 – tieto miesta AI spracuje dôkladnejšie.</li>
                <li>Nahrávaj v súlade s pravidlami školy a so súhlasom vyučujúceho.</li>
              </ul>
            </div>
          </>
        ) : null}

        {interrupted ? (
          <>
            <div className="warn-box small">
              {rec.error ?? 'Nahrávanie sa prerušilo (appka bola zatvorená alebo zamknutá).'} Doterajšia nahrávka je uložená.
            </div>
            <button className="btn block big red" onClick={start} disabled={busy || !!unsupported || otherActive}>
              {busy ? <span className="spin" /> : '●'} Pokračovať v nahrávaní
            </button>
            <div className="spacer" />
            <button className="btn block ghost" onClick={finishWithout} disabled={busy}>
              Ukončiť a prepísať doterajšiu nahrávku
            </button>
          </>
        ) : null}

        {phase === 'recording' || phase === 'paused' || phase === 'starting' || phase === 'stopping' ? (
          <>
            <div className="mark-btns">
              <button
                className={`btn secondary ${flash === 'star' ? 'flash' : ''}`}
                onClick={() => void addMark('star')}
                disabled={phase !== 'recording'}
              >
                <span className="e">⭐</span>Dôležité{stars ? ` (${stars})` : ''}
              </button>
              <button
                className={`btn danger ${flash === 'exam' ? 'flash' : ''}`}
                onClick={() => void addMark('exam')}
                disabled={phase !== 'recording'}
              >
                <span className="e">🎯</span>Bude na skúške{exams ? ` (${exams})` : ''}
              </button>
            </div>
            <div className="btn-row">
              {phase === 'paused' ? (
                <button className="btn secondary" onClick={() => act(resumeRecording)} disabled={busy}>
                  ▶︎ Pokračovať
                </button>
              ) : (
                <button className="btn secondary" onClick={() => act(pauseRecording)} disabled={busy || phase !== 'recording'}>
                  ⏸ Pauza
                </button>
              )}
              <button className="btn red" onClick={stop} disabled={busy || phase === 'stopping' || phase === 'starting'}>
                ⏹ Ukončiť
              </button>
            </div>
            <div className="spacer" />
            <PhotoButton lectureId={lectureId} getTime={() => recorderState.get().elapsedSec} className="btn block ghost" />
            <div className="spacer" />
            <div className="card flat small">
              <div className="row">
                <span className="grow">
                  {rec.wakeLock === 'on'
                    ? '🔆 Obrazovka sa nezamkne'
                    : rec.wakeLock === 'unsupported'
                      ? '⚠️ Tento prehliadač nevie zabrániť zamknutiu obrazovky. Nastav si Nastavenia → Displej a jas → Automatické zamykanie → Nikdy.'
                      : '⚠️ Obrazovka sa môže zamknúť – nastav Automatické zamykanie na „Nikdy“.'}
                </span>
              </div>
              {phase === 'recording' ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn small ghost" onClick={() => setBlack(true)}>
                    🌙 Úsporná čierna obrazovka
                  </button>
                  <label className="check small" style={{ padding: 0 }}>
                    <input
                      type="checkbox"
                      checked={!!settings?.blackScreen}
                      onChange={(e) => void saveSettings({ blackScreen: e.target.checked })}
                    />
                    zapínať automaticky
                  </label>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
