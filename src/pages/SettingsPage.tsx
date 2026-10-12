import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnthropicProvider } from '../ai/anthropic'
import { db, saveSettings } from '../db/db'
import { exportBackup, importBackup, wipeAll } from '../db/backup'
import type { AiMode, Settings, TranscriptionProviderId } from '../db/types'
import { safeFilename, shareOrDownload } from '../lib/exportMd'
import { fmtBytes, fmtDate, fmtDuration } from '../lib/text'
import { OpenAICompatibleProvider, PROVIDERS } from '../transcription/provider'
import { queue } from '../transcription/queue'
import { useLive, useSettings } from '../ui/hooks'
import { TopBar } from '../ui/Layout'
import { navigate } from '../ui/router'
import { toast, toastError } from '../ui/toast'

function mask(k: string) {
  if (!k) return 'nezadaný'
  return `••••${k.slice(-4)}`
}

function KeyField({
  label,
  value,
  onSave,
  onTest,
  help,
}: {
  label: string
  value: string
  onSave: (v: string) => Promise<void>
  onTest: (v: string) => Promise<void>
  help?: ReactNode
}) {
  const [editing, setEditing] = useState(!value)
  const [v, setV] = useState(value)
  const [show, setShow] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) setV(value)
  }, [value, editing])

  const test = async (key: string) => {
    setBusy(true)
    setStatus(null)
    try {
      await onTest(key)
      setStatus({ ok: true, text: '✅ Kľúč funguje.' })
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span className="small" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
        {label}
      </span>
      {editing ? (
        <div className="stack">
          <div className="row">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={v}
              onChange={(e) => setV(e.target.value)}
              placeholder="Vlož kľúč"
            />
            <button className="btn small ghost" onClick={() => setShow((s) => !s)} aria-label={show ? 'Skryť' : 'Ukázať'}>
              {show ? '🙈' : '👁'}
            </button>
          </div>
          <div className="btn-row">
            <button
              className="btn small"
              onClick={async () => {
                await onSave(v.trim())
                setEditing(!v.trim())
                toast(v.trim() ? 'Kľúč uložený' : 'Kľúč odstránený')
                if (v.trim()) void test(v.trim())
              }}
            >
              Uložiť
            </button>
            {value ? (
              <button className="btn small ghost" onClick={() => setEditing(false)}>
                Zrušiť
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <span className="mono grow">{mask(value)}</span>
          <button className="btn small ghost" onClick={() => void test(value)} disabled={busy}>
            {busy ? <span className="spin" /> : 'Otestovať kľúč'}
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              setV('')
              setEditing(true)
            }}
          >
            Zmeniť
          </button>
        </div>
      )}
      {status ? <div className={status.ok ? 'ok-box small' : 'err small'}>{status.text}</div> : null}
      {help ? <small className="muted">{help}</small> : null}
    </div>
  )
}

function TextSetting({ label, value, onSave, list, placeholder, help }: { label: string; value: string; onSave: (v: string) => void; list?: string[]; placeholder?: string; help?: string }) {
  const [v, setV] = useState(value)
  const id = useId()
  useEffect(() => setV(value), [value])
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={v} list={list ? id : undefined} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} />
      {list ? (
        <datalist id={id}>
          {list.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ) : null}
      {help ? <small>{help}</small> : null}
    </label>
  )
}

export function SettingsPage() {
  const s = useSettings()
  const usage = useLive(() => db.usage.get('total'), [])
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const est = await navigator.storage?.estimate?.()
        const persisted = (await navigator.storage?.persisted?.()) ?? false
        setStorage({ usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted })
      } catch {
        setStorage(null)
      }
    })()
  }, [])

  if (!s) return null
  const save = async (patch: Partial<Settings>) => {
    await saveSettings(patch)
    queue.kick()
  }
  const p = s.provider

  const loadModels = async (key = s.keys.anthropic) => {
    try {
      const list = await new AnthropicProvider(key).listModels()
      setModels(list)
      return list
    } catch (e) {
      setModels(null)
      throw e
    }
  }

  const backup = async (includeAudio: boolean) => {
    setBackupBusy(true)
    try {
      const json = await exportBackup({ includeAudio, includeKeys: false })
      await shareOrDownload(`skuskovnik-zaloha-${safeFilename(fmtDate(Date.now()))}.json`, json, 'application/json')
    } catch (e) {
      toastError((e as Error).message)
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <>
      <TopBar title="Nastavenia" />
      <div className="page">
        <div className="section-title">Prepis reči na text</div>
        <div className="card">
          <label className="field">
            <span>Služba</span>
            <select value={p} onChange={(e) => void save({ provider: e.target.value as TranscriptionProviderId })}>
              {(Object.keys(PROVIDERS) as TranscriptionProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </label>
          {p === 'custom' ? (
            <TextSetting
              label="Base URL (OpenAI-kompatibilná)"
              value={s.customBaseUrl}
              placeholder="https://server/v1"
              onSave={(v) => void save({ customBaseUrl: v })}
              help="Appka volá {URL}/audio/transcriptions a {URL}/models. Server musí povoliť prístup z prehliadača (CORS)."
            />
          ) : null}
          <KeyField
            key={p}
            label={`API kľúč – ${p === 'groq' ? 'Groq' : p === 'openai' ? 'OpenAI' : 'vlastný server'}`}
            value={s.keys[p]}
            onSave={(v) => save({ keys: { ...s.keys, [p]: v } })}
            onTest={(v) =>
              new OpenAICompatibleProvider({ name: PROVIDERS[p].label, baseUrl: p === 'custom' ? s.customBaseUrl : PROVIDERS[p].baseUrl, apiKey: v, model: s.models[p] }).testKey()
            }
            help={
              PROVIDERS[p].keyUrl ? (
                <>
                  Kľúč získaš na{' '}
                  <a href={PROVIDERS[p].keyUrl} target="_blank" rel="noopener noreferrer">
                    {PROVIDERS[p].keyUrl!.replace('https://', '')}
                  </a>
                  . {p === 'groq' ? 'Groq má bezplatný limit, ktorý na prednášky zvyčajne stačí.' : ''}
                </>
              ) : undefined
            }
          />
          <TextSetting label="Model" value={s.models[p]} list={PROVIDERS[p].models} onSave={(v) => void save({ models: { ...s.models, [p]: v || PROVIDERS[p].models[0] } })} />
          <label className="field">
            <span>Dĺžka úseku nahrávky</span>
            <select value={s.segmentMinutes} onChange={(e) => void save({ segmentMinutes: Number(e.target.value) })}>
              {[2, 3, 5, 8, 10].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
            <small>Kratšie úseky = prepis skôr počas nahrávania, dlhšie = menej požiadaviek.</small>
          </label>
        </div>

        <div className="section-title">Učebný materiál (Claude)</div>
        <div className="card">
          <label className="field">
            <span>Predvolený režim</span>
            <select value={s.aiMode ?? 'auto'} onChange={(e) => void save({ aiMode: e.target.value === 'auto' ? null : (e.target.value as AiMode) })}>
              <option value="auto">Automaticky (API, ak je zadaný kľúč)</option>
              <option value="claudeApp">Cez Claude appku (bez platenia za API)</option>
              <option value="api">Automaticky cez Anthropic API (platené)</option>
            </select>
            <small>
              <b>Claude appka:</b> skopíruješ zadanie do claude.ai a odpoveď vložíš späť – stačí bežné predplatné. <b>API:</b> všetko automaticky, platí sa podľa spotreby.
            </small>
          </label>
          <KeyField
            label="Anthropic API kľúč (len pre režim API)"
            value={s.keys.anthropic}
            onSave={(v) => save({ keys: { ...s.keys, anthropic: v } })}
            onTest={async (v) => {
              await loadModels(v)
            }}
            help={
              <>
                Kľúč získaš na{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                  console.anthropic.com
                </a>
                . Ukladá sa len v tomto zariadení.
              </>
            }
          />
          <TextSetting
            label="Model na materiál a testy"
            value={s.anthropicModel}
            list={models?.map((m) => m.id) ?? ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']}
            onSave={(v) => void save({ anthropicModel: v || 'claude-sonnet-5-5' })}
          />
          <TextSetting
            label="Lacný model (hodnotenie otvorených odpovedí)"
            value={s.anthropicCheapModel}
            list={models?.map((m) => m.id) ?? ['claude-haiku-5-5']}
            onSave={(v) => void save({ anthropicCheapModel: v || 'claude-haiku-5-5' })}
          />
          {s.keys.anthropic ? (
            <button
              className="btn small ghost"
              onClick={async () => {
                try {
                  const l = await loadModels()
                  toast(`Načítaných ${l.length} modelov – vyber v poli Model`)
                } catch (e) {
                  toastError((e as Error).message)
                }
              }}
            >
              Načítať zoznam modelov
            </button>
          ) : null}
          {models ? (
            <div className="small muted" style={{ marginTop: 6 }}>
              Dostupné: {models.map((m) => m.id).join(', ')}
            </div>
          ) : null}
          <label className="check">
            <input type="checkbox" checked={s.allowSupplement} onChange={(e) => void save({ allowSupplement: e.target.checked })} />
            <span>Povoliť krátke doplnenia mimo prednášky (vždy označené „Doplnenie (mimo prednášky)“)</span>
          </label>
        </div>

        <div className="section-title">Testy</div>
        <div className="card">
          <label className="field">
            <span>Podiel skúškových otázok: {s.examShare} %</span>
            <input type="range" min={0} max={100} step={10} value={s.examShare} onChange={(e) => void save({ examShare: Number(e.target.value) })} style={{ width: '100%' }} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.instantFeedback} onChange={(e) => void save({ instantFeedback: e.target.checked })} />
            <span>Okamžitá spätná väzba po každej otázke</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.aiGrading} onChange={(e) => void save({ aiGrading: e.target.checked })} />
            <span>Ponúkať AI hodnotenie otvorených odpovedí (len s Anthropic kľúčom)</span>
          </label>
        </div>

        <div className="section-title">Vzhľad</div>
        <div className="card">
          <label className="field">
            <span>Veľkosť písma</span>
            <div className="seg">
              {[
                [0.9, 'Menšie'],
                [1, 'Normálne'],
                [1.15, 'Väčšie'],
                [1.3, 'Najväčšie'],
              ].map(([v, l]) => (
                <button key={v} className={s.fontScale === v ? 'on' : ''} onClick={() => void save({ fontScale: v as number })}>
                  {l}
                </button>
              ))}
            </div>
          </label>
          <small className="muted">Svetlý a tmavý režim sa riadi nastavením systému.</small>
        </div>

        <div className="section-title">Úložisko a dáta</div>
        <div className="card">
          {storage ? (
            <p className="small" style={{ marginTop: 0 }}>
              Využité: <b>{fmtBytes(storage.usage)}</b>
              {storage.quota ? ` z ${fmtBytes(storage.quota)}` : ''} ·{' '}
              {storage.persisted ? '✅ trvalé úložisko' : '⚠️ prehliadač môže dáta pri nedostatku miesta zmazať – rob si zálohy'}
            </p>
          ) : null}
          <label className="check">
            <input type="checkbox" checked={s.deleteAudioAfter} onChange={(e) => void save({ deleteAudioAfter: e.target.checked })} />
            <span>Po vytvorení materiálu automaticky zmazať audio (prepis zostane, ušetrí miesto)</span>
          </label>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn small secondary" disabled={backupBusy} onClick={() => void backup(false)}>
              💾 Záloha (bez audia)
            </button>
            <button className="btn small secondary" disabled={backupBusy} onClick={() => void backup(true)}>
              💾 Záloha s audiom
            </button>
            <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
              📂 Obnoviť zo zálohy
            </button>
          </div>
          <small className="muted">API kľúče sa do zálohy neukladajú.</small>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const r = await importBackup(await f.text())
                toast(`Obnovené: ${r.rows} záznamov`)
              } catch (err) {
                toastError((err as Error).message)
              }
            }}
          />
          <div className="spacer" />
          <button
            className="btn block danger small"
            onClick={async () => {
              if (!confirm('Naozaj zmazať VŠETKY dáta appky (prednášky, audio, materiály, testy, nastavenia)? Toto sa nedá vrátiť.')) return
              await wipeAll()
              toast('Všetko zmazané')
              navigate('/vitaj', true)
            }}
          >
            Zmazať všetky dáta
          </button>
        </div>

        <div className="section-title">Spotreba</div>
        <div className="card small">
          Prepísané audio: <b>{fmtDuration(usage?.audioSec ?? 0)}</b>
          <br />
          Claude API: <b>{(usage?.inputTokens ?? 0).toLocaleString('sk-SK')}</b> vstupných a <b>{(usage?.outputTokens ?? 0).toLocaleString('sk-SK')}</b> výstupných tokenov
        </div>

        <div className="section-title">O appke</div>
        <div className="card small">
          <p style={{ marginTop: 0 }}>
            Skúškovník {__APP_VERSION__} · všetky dáta sú len v tomto zariadení. Kľúče sa posielajú iba priamo službám (Groq/OpenAI/Anthropic).
          </p>
          <div className="btn-row">
            <a className="btn small ghost" href="#/vitaj">
              Zobraziť úvod
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
