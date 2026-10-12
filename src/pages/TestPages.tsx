import { TopBar } from '../ui/Layout'

// Dočasné obrazovky – implementujú sa vo fáze 5.
export function TestRunPage(_props: { testId?: string }) {
  void _props
  return (
    <>
      <TopBar title="Test" back />
      <div className="page muted">Pripravuje sa.</div>
    </>
  )
}

export function ResultPage(_props: { attemptId?: string }) {
  void _props
  return (
    <>
      <TopBar title="Výsledok" back />
      <div className="page muted">Pripravuje sa.</div>
    </>
  )
}
