import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ReviewPage from './pages/ReviewPage'
import EmailTestPage from './pages/EmailTestPage'
import EmailLivePage from './pages/EmailLivePage'
import ApprovalPage from './pages/ApprovalPage'
import CodeReviewPage from './pages/CodeReviewPage'
import HomePage from './pages/HomePage'
import FormReviewPage from './pages/FormReviewPage'
import SelectionPage from './pages/SelectionPage'
import TrajectoryPage from './pages/TrajectoryPage'
import PlanPage from './pages/PlanPage'
import PlanTestPage from './pages/PlanTestPage'
import MemoryManagementPage from './pages/MemoryManagementPage'
import MemoryReviewPage from './pages/MemoryReviewPage'
import MemoryTestPage from './pages/MemoryTestPage'
import PortsPage from './pages/PortsPage'
import PreferencesPage from './pages/PreferencesPage'
import CompletedPage from './pages/CompletedPage'
import IconTestPage from './pages/IconTestPage'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'only light'
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) ?? 'system')

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Keep in sync when system preference changes (only matters in 'system' mode)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { if (theme === 'system') applyTheme('system') }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return [theme, setTheme] as const
}

const ICONS: Record<Theme, string> = { light: '☀', dark: '☽', system: '💻' }
const OPTIONS: Theme[] = ['light', 'dark', 'system']

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="fixed top-3 right-3 z-50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shadow-sm transition-colors"
        title="Theme"
      >
        {ICONS[theme]}
      </button>

      {open && (
        <div className="absolute top-10 right-0 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-md overflow-hidden min-w-[100px]">
          {OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => { setTheme(opt); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors
                ${theme === opt
                  ? 'bg-gray-100 dark:bg-zinc-800 text-zinc-900 dark:text-slate-100 font-medium'
                  : 'text-zinc-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-zinc-800'
                }`}
            >
              <span>{ICONS[opt]}</span>
              <span className="capitalize">{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/review/:id" element={<ReviewPage />} />
        <Route path="/email-test" element={<EmailTestPage />} />
        <Route path="/email-live" element={<EmailLivePage />} />
        <Route path="/approval/:id" element={<ApprovalPage />} />
        <Route path="/code-review/:id" element={<CodeReviewPage />} />
        <Route path="/form-review/:id" element={<FormReviewPage />} />
        <Route path="/selection/:id" element={<SelectionPage />} />
        <Route path="/trajectory/:id" element={<TrajectoryPage />} />
        <Route path="/plan/:id" element={<PlanPage />} />
        <Route path="/plan-test" element={<PlanTestPage />} />
        <Route path="/memory-management" element={<MemoryManagementPage />} />
        <Route path="/memory/:id" element={<MemoryReviewPage />} />
        <Route path="/memory-test" element={<MemoryTestPage />} />
        <Route path="/ports" element={<PortsPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route path="/completed" element={<CompletedPage />} />
        <Route path="/icon-test" element={<IconTestPage />} />
      </Routes>
    </BrowserRouter>
  )
}
