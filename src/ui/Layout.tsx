import type { ReactNode } from 'react'
import { goBack } from './router'

export function TopBar({ title, back, right }: { title: string; back?: string | boolean; right?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <button className="back" onClick={() => goBack(typeof back === 'string' ? back : '/')} aria-label="Späť">
          ‹ Späť
        </button>
      ) : null}
      <h1>{title}</h1>
      {right}
    </header>
  )
}

const TABS = [
  { href: '#/', key: '', ico: '📚', label: 'Prednášky' },
  { href: '#/nova?zdroj=nahravat', key: 'nova', ico: '●', label: 'Nahrávať', cls: 'rec' },
  { href: '#/opakovanie', key: 'opakovanie', ico: '🔁', label: 'Opakovanie' },
  { href: '#/nastavenia', key: 'nastavenia', ico: '⚙️', label: 'Nastavenia' },
]

export function TabBar({ active, recordingHref }: { active: string; recordingHref?: string | null }) {
  return (
    <nav className="tabbar no-print">
      <div className="tabbar-inner">
        {TABS.map((t) => {
          const href = t.key === 'nova' && recordingHref ? recordingHref : t.href
          const on = t.key === active || (t.key === 'nova' && active === 'nahravat')
          return (
            <a key={t.key} href={href} className={`${on ? 'active' : ''} ${t.cls ?? ''}`}>
              <span className="ico">{t.ico}</span>
              {t.key === 'nova' && recordingHref ? 'Nahráva sa' : t.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Empty({ ico, title, children }: { ico: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big-ico">{ico}</div>
      <h2>{title}</h2>
      {children}
    </div>
  )
}
