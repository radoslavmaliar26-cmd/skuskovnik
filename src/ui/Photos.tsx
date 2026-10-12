import { useEffect, useRef, useState } from 'react'
import { resizeImage } from '../ai/photos'
import { db } from '../db/db'
import type { Photo } from '../db/types'
import { fmtTime, uid } from '../lib/text'
import { useLive } from './hooks'
import { toast, toastError } from './toast'

/** Tlačidlo „Fotka tabule/slajdu“ – odfotí, zmenší na max. 1568 px a uloží s časom prednášky. */
export function PhotoButton({ lectureId, getTime, className }: { lectureId: string; getTime: () => number; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const timeRef = useRef(0)
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setBusy(true)
          try {
            const small = await resizeImage(f)
            const data = await small.arrayBuffer()
            await db.photos.add({ id: uid(), lectureId, t: timeRef.current, mime: 'image/jpeg', data, createdAt: Date.now() })
            toast(`📷 Fotka uložená (${fmtTime(timeRef.current)})`)
          } catch (err) {
            toastError(`Fotku sa nepodarilo uložiť: ${(err as Error).message}`)
          } finally {
            setBusy(false)
          }
        }}
      />
      <button
        className={className ?? 'btn secondary'}
        disabled={busy}
        onClick={() => {
          // čas zachytíme v momente ťuknutia (fotenie môže chvíľu trvať)
          timeRef.current = getTime()
          ref.current?.click()
        }}
      >
        {busy ? <span className="spin" /> : '📷'} Fotka tabule
      </button>
    </>
  )
}

function Thumb({ p, lectureId }: { p: Photo; lectureId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([p.data], { type: p.mime }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [p])
  if (!url) return null
  return (
    <div style={{ flex: 'none', width: big ? '100%' : 120 }}>
      <img
        src={url}
        alt={`Fotka ${fmtTime(p.t)}`}
        onClick={() => setBig((b) => !b)}
        style={{ width: '100%', borderRadius: 10, display: 'block', cursor: 'zoom-in' }}
      />
      <div className="row small" style={{ marginTop: 4 }}>
        <a className="time-link" href={`#/p/${lectureId}/prepis?t=${Math.floor(p.t)}`}>
          {fmtTime(p.t)}
        </a>
        <button
          className="time-link"
          style={{ background: 'transparent' }}
          onClick={async () => {
            if (confirm('Zmazať fotku?')) await db.photos.delete(p.id)
          }}
          aria-label="Zmazať fotku"
        >
          🗑
        </button>
      </div>
    </div>
  )
}

/** Pás fotiek prednášky. */
export function PhotoStrip({ lectureId }: { lectureId: string }) {
  const photos = useLive(() => db.photos.where('lectureId').equals(lectureId).sortBy('t'), [lectureId])
  if (!photos?.length) return null
  return (
    <div className="card">
      <div className="small muted" style={{ marginBottom: 8 }}>
        📷 Fotky z prednášky ({photos.length}) – ťuknutím zväčšíš. V režime API ich dostane aj Claude.
      </div>
      <div className="row" style={{ overflowX: 'auto', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {photos.map((p) => (
          <Thumb key={p.id} p={p} lectureId={lectureId} />
        ))}
      </div>
    </div>
  )
}
