import { db } from '../../db/db'
import type { Lecture, StoredMaterial } from '../../db/types'
import { copyText } from '../../lib/clipboard'
import { materialToMarkdown, safeFilename, shareOrDownload } from '../../lib/exportMd'
import { useLive } from '../../ui/hooks'
import { toast, toastError } from '../../ui/toast'

export function ExportBar({ lecture, material }: { lecture: Lecture; material: StoredMaterial }) {
  // názov predmetu načítame vopred – iOS dovolí schránku/zdieľanie len hneď po ťuknutí (bez čakania na databázu)
  const subject = useLive(() => db.subjects.get(lecture.subjectId), [lecture.subjectId])
  const md = () => materialToMarkdown(material.data, lecture, subject?.name)
  return (
    <div className="card flat no-print">
      <div className="small muted" style={{ marginBottom: 8 }}>
        Export materiálu
      </div>
      <div className="btn-row">
        <button
          className="btn small secondary"
          onClick={async () => {
            try {
              const r = await shareOrDownload(`${safeFilename(lecture.title)}.md`, md())
              if (r === 'downloaded') toast('Súbor stiahnutý')
            } catch (e) {
              toastError((e as Error).message)
            }
          }}
        >
          📤 Markdown
        </button>
        <button
          className="btn small secondary"
          onClick={async () => {
            if (await copyText(md())) toast('Markdown skopírovaný')
            else toastError('Kopírovanie zlyhalo – skús to znova.')
          }}
        >
          📋 Kopírovať
        </button>
        <button className="btn small secondary" onClick={() => window.print()}>
          🖨 Tlač / PDF
        </button>
      </div>
    </div>
  )
}
