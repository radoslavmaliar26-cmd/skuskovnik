import { db } from '../../db/db'
import type { Lecture, StoredMaterial } from '../../db/types'
import { copyText } from '../../lib/clipboard'
import { materialToMarkdown, safeFilename, shareOrDownload } from '../../lib/exportMd'
import { toast, toastError } from '../../ui/toast'

export function ExportBar({ lecture, material }: { lecture: Lecture; material: StoredMaterial }) {
  const md = async () => {
    const subject = await db.subjects.get(lecture.subjectId)
    return materialToMarkdown(material.data, lecture, subject?.name)
  }
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
              const r = await shareOrDownload(`${safeFilename(lecture.title)}.md`, await md())
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
            if (await copyText(await md())) toast('Markdown skopírovaný')
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
