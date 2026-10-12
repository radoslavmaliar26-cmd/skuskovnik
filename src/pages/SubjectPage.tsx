import { TopBar } from '../ui/Layout'

// Dočasná obrazovka – implementuje sa v ďalšej fáze.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SubjectPage(_props: Record<string, unknown>) {
  return (
    <>
      <TopBar title="Skúškovník" back />
      <div className="page muted">Pripravuje sa.</div>
    </>
  )
}
