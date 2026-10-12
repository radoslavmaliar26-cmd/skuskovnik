import type { Lecture, Mark, StoredMaterial, Transcript } from '../../db/types'

// Dočasné – implementuje sa vo fáze 4.
export function MaterialTab(_p: { lecture: Lecture; material?: StoredMaterial; transcript?: Transcript; marks: Mark[]; focusSection?: string }) {
  void _p
  return <div className="empty">Materiál sa pripravuje.</div>
}
