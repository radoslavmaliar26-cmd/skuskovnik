import { useState } from 'react'
import { saveSettings } from '../db/db'
import { loadDemo } from '../demo/loadDemo'
import { navigate } from '../ui/router'
import { toastError } from '../ui/toast'

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function OnboardingPage() {
  const [busy, setBusy] = useState(false)
  const standalone = isStandalone()

  const finish = async (demo: boolean) => {
    setBusy(true)
    try {
      await saveSettings({ onboarded: true })
      if (demo) {
        const id = await loadDemo()
        navigate(`/p/${id}/material`, true)
      } else {
        navigate('/', true)
      }
    } catch (e) {
      toastError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="page" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
      <div className="center">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={84} height={84} style={{ borderRadius: 20 }} />
        <h1 style={{ marginTop: 10 }}>Skúškovník</h1>
        <p className="muted">Nahraj prednášku → appka ju prepíše, spraví z nej prehľadný materiál, zvýrazní, čo bude na skúške, a vyskúša ťa testom.</p>
      </div>

      {!standalone ? (
        <div className="card" style={{ borderTop: '4px solid var(--accent)' }}>
          <h3>📲 Pridaj si appku na plochu</h3>
          {isIOS() ? (
            <ol className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
              <li>V Safari ťukni na tlačidlo Zdieľať (štvorec so šípkou).</li>
              <li>Zvoľ „Pridať na plochu“ a potvrď.</li>
              <li>Spúšťaj Skúškovník z plochy – beží na celú obrazovku a funguje aj offline.</li>
            </ol>
          ) : (
            <p className="small" style={{ margin: 0 }}>V prehliadači zvoľ „Inštalovať aplikáciu“ / „Pridať na plochu“.</p>
          )}
          <p className="small warn-box" style={{ marginBottom: 0 }}>
            Appka na ploche má <b>oddelené úložisko</b> od Safari – kľúče a prednášky zadávaj až v nainštalovanej appke.
          </p>
        </div>
      ) : null}

      <div className="card">
        <h3>🎙 Ako nahrávať</h3>
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>Počas nahrávania nechaj appku otvorenú na popredí – iOS pri zamknutí alebo odchode do inej appky nahrávanie preruší (appka ho uloží a ponúkne pokračovanie).</li>
          <li>Ideálne daj mobil na nabíjačku a čo najbližšie k vyučujúcemu.</li>
          <li>Keď vyučujúci povie niečo dôležité, ťukni na ⭐ alebo 🎯 „Bude na skúške“.</li>
          <li>Hotové nahrávky (napr. z Hlasových poznámok) môžeš aj importovať, alebo vložiť hotový text prepisu.</li>
        </ul>
      </div>

      <div className="card">
        <h3>🔑 Prepis – Groq kľúč (zadarmo)</h3>
        <p className="small" style={{ margin: 0 }}>
          Na prepis reči na text potrebuješ API kľúč. Najjednoduchšie: zaregistruj sa na{' '}
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
            console.groq.com/keys
          </a>
          , vytvor kľúč a vlož ho v appke do <b>Nastavenia → Prepis</b>. Groq má bezplatný limit.
        </p>
      </div>

      <div className="card">
        <h3>✨ Dva režimy AI pre materiál</h3>
        <p className="small" style={{ marginTop: 0 }}>
          <b>Cez Claude appku</b> (predvolené, bez platenia za API): appka skopíruje zadanie, ty ho vložíš do Claude (claude.ai alebo appka Claude), odpoveď skopíruješ späť.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          <b>Automaticky cez Anthropic API</b>: po zadaní Anthropic kľúča všetko prebehne samo; platí sa podľa spotreby.
        </p>
      </div>

      <button className="btn block big" disabled={busy} onClick={() => void finish(true)}>
        ▶︎ Vyskúšať demo
      </button>
      <div className="spacer" />
      <button className="btn block secondary" disabled={busy} onClick={() => void finish(false)}>
        Začať
      </button>
      <p className="small muted center" style={{ marginTop: 18 }}>
        Nahrávaj v súlade s pravidlami školy a so súhlasom vyučujúceho. Všetky dáta zostávajú len v tvojom zariadení.
      </p>
    </div>
  )
}
