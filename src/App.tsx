import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { HomePage } from './pages/HomePage'
import { LecturePage } from './pages/LecturePage'
import { LivePage } from './pages/LivePage'
import { NewLecturePage } from './pages/NewLecturePage'
import { OnboardingPage } from './pages/OnboardingPage'
import { RecordPage } from './pages/RecordPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { SubjectPage } from './pages/SubjectPage'
import { ResultPage, TestRunPage } from './pages/TestPages'
import { recorderState } from './audio/session'
import { useSettings, useStore } from './ui/hooks'
import { TabBar } from './ui/Layout'
import { navigate, useRoute } from './ui/router'
import { Toasts } from './ui/toast'

function UpdateBar() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  const rec = useStore(recorderState)
  if (!needRefresh) return null
  return (
    <div className="update-bar no-print">
      <span className="grow">Je dostupná nová verzia appky.</span>
      {rec.active ? (
        <span className="small">Obnov po nahrávaní</span>
      ) : (
        <button className="btn" onClick={() => updateServiceWorker(true)}>
          Obnoviť
        </button>
      )}
      <button className="btn" onClick={() => setNeedRefresh(false)} aria-label="Zavrieť">
        ✕
      </button>
    </div>
  )
}

export default function App() {
  const route = useRoute()
  const settings = useSettings()
  const rec = useStore(recorderState)
  const [first, second, third] = route.path

  useEffect(() => {
    if (settings) document.documentElement.style.setProperty('--fs', String(settings.fontScale || 1))
  }, [settings])

  useEffect(() => {
    if (settings && !settings.onboarded && first !== 'vitaj') navigate('/vitaj', true)
  }, [settings, first])

  if (!settings) return null

  let page
  switch (first) {
    case undefined:
      page = <HomePage />
      break
    case 'vitaj':
      page = <OnboardingPage />
      break
    case 'nova':
      page = <NewLecturePage query={route.query} />
      break
    case 'nahravat':
      page = <RecordPage lectureId={second} />
      break
    case 'zivy':
      page = <LivePage lectureId={second} />
      break
    case 'p':
      page = <LecturePage lectureId={second} tab={third} query={route.query} />
      break
    case 'test':
      page = <TestRunPage testId={second} />
      break
    case 'vysledok':
      page = <ResultPage attemptId={second} />
      break
    case 'opakovanie':
      page = <ReviewPage />
      break
    case 'predmet':
      page = <SubjectPage subjectId={second} tab={third} />
      break
    case 'nastavenia':
      page = <SettingsPage />
      break
    default:
      page = <HomePage />
  }

  const recordingHref = rec.active && rec.lectureId ? `#/nahravat/${rec.lectureId}` : null

  return (
    <div className="app">
      <UpdateBar />
      {page}
      {first !== 'vitaj' && first !== 'test' ? <TabBar active={first ?? ''} recordingHref={recordingHref} /> : null}
      <Toasts />
    </div>
  )
}
