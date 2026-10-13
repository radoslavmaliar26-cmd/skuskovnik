import { useState } from 'react'
import { generateNewTestApi, type NewTestOptions } from '../../ai/jobs'
import { parseNewTestResponse } from '../../ai/parser'
import { buildNewTestPrompt, buildRepairPrompt } from '../../ai/prompts'
import { QUESTION_TYPE_LABELS, type QuestionType } from '../../ai/schema'
import { verifyQuestions } from '../../ai/verify'
import { db } from '../../db/db'
import { effectiveAiMode, type AiMode, type Attempt, type Lecture, type StoredMaterial, type StoredTest } from '../../db/types'
import { createRetryTest, saveNewTest } from '../../exam/tests'
import { copyText, readClipboard } from '../../lib/clipboard'
import { fmtDateTime, plural } from '../../lib/text'
import { useLive, useOnline, useSettings } from '../../ui/hooks'
import { navigate } from '../../ui/router'
import { toast, toastError } from '../../ui/toast'

const ALL_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]

function NewTestCard({ lecture, material, existing, onClose }: { lecture: Lecture; material: StoredMaterial; existing: StoredTest[]; onClose: () => void }) {
  const settings = useSettings()
  const online = useOnline()
  const [opts, setOpts] = useState<NewTestOptions>({ count: 10, types: [...ALL_TYPES], difficulty: [1, 2, 3], onlyExam: false })
  const [mode, setMode] = useState<AiMode | null>(null)
  const [parts, setParts] = useState<string[]>([])
  const [paste, setPaste] = useState('')
  const [errors, setErrors] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  // prepis načítame vopred – iOS dovolí zápis do schránky len hneď po ťuknutí
  const transcript = useLive(() => db.transcripts.get(lecture.id), [lecture.id])
  if (!settings) return null
  const activeMode = mode ?? effectiveAiMode(settings)
  const hasKey = !!settings.keys.anthropic.trim()
  const existingQs = existing.flatMap((t) => t.questions)

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const save = async (questions: Parameters<typeof saveNewTest>[2]) => {
    const transcript = await db.transcripts.get(lecture.id)
    verifyQuestions(questions, transcript?.paragraphs ?? [])
    const t = await saveNewTest(lecture.id, lecture.subjectId, questions)
    toast(`Nový test: ${questions.length} ${plural(questions.length, 'otázka', 'otázky', 'otázok')}`)
    onClose()
    navigate(`/test/${t.id}`)
  }

  const prompt = () => {
    return buildNewTestPrompt({ material: material.data, existing: existingQs, ...opts, examShare: settings.examShare, mode: 'claudeApp', paragraphs: transcript?.paragraphs })
  }

  const runApi = async () => {
    setBusy(true)
    try {
      const qs = await generateNewTestApi(material, existingQs, opts)
      await save(qs)
    } catch (e) {
      toastError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const process = async (all: string[]) => {
    setErrors(null)
    const r = parseNewTestResponse(all)
    if (!r.ok) {
      setErrors(r.errors)
      return
    }
    await save(r.data.otazky)
  }

  return (
    <div className="card">
      <h3>Nový test</h3>
      <label className="field">
        <span>Počet otázok</span>
        <div className="seg">
          {[10, 20, 30].map((n) => (
            <button key={n} className={opts.count === n ? 'on' : ''} onClick={() => setOpts({ ...opts, count: n })}>
              {n}
            </button>
          ))}
        </div>
      </label>
      <div className="field">
        <span className="small" style={{ fontWeight: 600 }}>
          Typy otázok
        </span>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {ALL_TYPES.map((t) => (
            <label key={t} className="check small" style={{ padding: '2px 8px 2px 0' }}>
              <input type="checkbox" checked={opts.types.includes(t)} onChange={() => setOpts({ ...opts, types: toggle(opts.types, t) })} />
              {QUESTION_TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="small" style={{ fontWeight: 600 }}>
          Obtiažnosť
        </span>
        <div className="row wrap" style={{ marginTop: 6 }}>
          {[1, 2, 3].map((d) => (
            <label key={d} className="check small" style={{ padding: '2px 8px 2px 0' }}>
              <input type="checkbox" checked={opts.difficulty.includes(d)} onChange={() => setOpts({ ...opts, difficulty: toggle(opts.difficulty, d) })} />
              {d === 1 ? 'ľahká' : d === 2 ? 'stredná' : 'ťažká'}
            </label>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={opts.onlyExam} onChange={(e) => setOpts({ ...opts, onlyExam: e.target.checked })} />
        Len skúškové témy
      </label>

      <div className="seg" style={{ margin: '10px 0' }}>
        <button className={activeMode === 'claudeApp' ? 'on' : ''} onClick={() => setMode('claudeApp')}>
          Cez Claude appku
        </button>
        <button className={activeMode === 'api' ? 'on' : ''} onClick={() => setMode('api')}>
          Automaticky (API)
        </button>
      </div>

      {!opts.types.length || !opts.difficulty.length ? <div className="warn-box small">Vyber aspoň jeden typ a jednu obtiažnosť.</div> : null}

      {activeMode === 'api' ? (
        <>
          {!hasKey ? (
            <div className="warn-box small">
              Chýba Anthropic API kľúč – <a href="#/nastavenia">Nastavenia</a>.
            </div>
          ) : null}
          <button className="btn block" disabled={!hasKey || !online || busy || !opts.types.length || !opts.difficulty.length} onClick={() => void runApi()}>
            {busy ? (
              <>
                <span className="spin" /> Claude pripravuje otázky…
              </>
            ) : (
              '✨ Vytvoriť test'
            )}
          </button>
        </>
      ) : (
        <div className="stack">
          <button
            className="btn block"
            disabled={!opts.types.length || !opts.difficulty.length}
            onClick={async () => {
              if (await copyText(prompt())) toast('Zadanie skopírované – vlož ho do Claude')
              else toastError('Kopírovanie zlyhalo – skús to znova.')
            }}
          >
            📋 Kopírovať pre Claude
          </button>
          <a className="btn block secondary" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            Otvoriť Claude ↗
          </a>
          <button
            className="btn block ghost"
            onClick={async () => {
              const t = await readClipboard()
              if (!t) {
                toastError('Schránka je prázdna alebo nedostupná – vlož odpoveď ručne nižšie.')
                return
              }
              const next = [...parts, t]
              setParts(next)
              await process(next)
            }}
          >
            📥 Vložiť odpoveď zo schránky
          </button>
          <details>
            <summary className="small">alebo vlož ručne</summary>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Odpoveď od Claude…" />
            <button
              className="btn small"
              style={{ marginTop: 6 }}
              disabled={!paste.trim()}
              onClick={async () => {
                const next = [...parts, paste]
                setParts(next)
                setPaste('')
                await process(next)
              }}
            >
              Spracovať
            </button>
          </details>
          {parts.length ? (
            <div className="small muted">
              Vložené časti: {parts.length}{' '}
              <button className="btn small ghost" onClick={() => setParts([])}>
                Vymazať
              </button>
            </div>
          ) : null}
          {errors ? (
            <div className="err small">
              {errors.slice(0, 5).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
              <button
                className="btn small"
                style={{ marginTop: 6 }}
                onClick={async () => {
                  if (await copyText(buildRepairPrompt(errors, 'test'))) toast('Opravná výzva skopírovaná')
                  else toastError('Kopírovanie zlyhalo – skús to znova.')
                }}
              >
                📋 Kopírovať opravnú výzvu
              </button>
            </div>
          ) : null}
        </div>
      )}
      <button className="btn block ghost" style={{ marginTop: 10 }} onClick={onClose}>
        Zavrieť
      </button>
    </div>
  )
}

export function TestTab({ lecture, material }: { lecture: Lecture; material?: StoredMaterial }) {
  const tests = useLive(() => db.tests.where('lectureId').equals(lecture.id).sortBy('createdAt'), [lecture.id])
  const attempts = useLive(() => db.attempts.where('lectureId').equals(lecture.id).toArray(), [lecture.id])
  const [newOpen, setNewOpen] = useState(false)

  if (!material) {
    return <div className="empty">Test vznikne spolu s materiálom. Najprv vytvor materiál.</div>
  }
  const byTest = new Map<string, Attempt[]>()
  for (const a of attempts ?? []) byTest.set(a.testId, [...(byTest.get(a.testId) ?? []), a])
  const anyWrong = (attempts ?? []).some((a) => a.finishedAt && Object.values(a.results).some((r) => !r.correct))

  const retryWrong = async () => {
    const t = await createRetryTest({ lectureId: lecture.id })
    if (t) navigate(`/test/${t.id}`)
    else toast('Žiadne chybné odpovede na zopakovanie 🎉')
  }

  return (
    <div>
      <div className="list">
        {(tests ?? []).map((t) => {
          const as = (byTest.get(t.id) ?? []).filter((a) => a.finishedAt).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
          const best = as.reduce((m, a) => Math.max(m, a.max ? a.score / a.max : 0), 0)
          const open = (byTest.get(t.id) ?? []).some((a) => !a.finishedAt)
          return (
            <a key={t.id} className="list-item" href={`#/test/${t.id}`}>
              <div className="grow">
                <div className="title">{t.title}</div>
                <div className="sub">
                  {t.questions.length} {plural(t.questions.length, 'otázka', 'otázky', 'otázok')}
                  {as.length ? ` · ${as.length}× · najlepšie ${Math.round(best * 100)} %` : ' · ešte nespustený'}
                  {open ? ' · rozpracovaný' : ''}
                </div>
              </div>
              <span className="btn small">{open ? 'Pokračovať' : 'Spustiť'}</span>
            </a>
          )
        })}
      </div>
      <div className="btn-row">
        <button className="btn secondary" onClick={() => setNewOpen(true)}>
          ＋ Nový test
        </button>
        {anyWrong ? (
          <button className="btn secondary" onClick={() => void retryWrong()}>
            🔁 Zopakovať chybné
          </button>
        ) : null}
      </div>
      <div className="spacer" />
      {newOpen ? <NewTestCard lecture={lecture} material={material} existing={tests ?? []} onClose={() => setNewOpen(false)} /> : null}

      {(attempts ?? []).filter((a) => a.finishedAt).length ? (
        <>
          <div className="section-title">História pokusov</div>
          <div className="list">
            {(attempts ?? [])
              .filter((a) => a.finishedAt)
              .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
              .slice(0, 15)
              .map((a) => {
                const t = (tests ?? []).find((x) => x.id === a.testId)
                return (
                  <a key={a.id} className="list-item" href={`#/vysledok/${a.id}`}>
                    <div className="grow">
                      <div className="title">{t?.title ?? 'Test'}</div>
                      <div className="sub">{fmtDateTime(a.finishedAt!)}</div>
                    </div>
                    <b>{a.max ? Math.round((a.score / a.max) * 100) : 0} %</b>
                    <span className="chev">›</span>
                  </a>
                )
              })}
          </div>
        </>
      ) : null}
    </div>
  )
}
