import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface SessionItem {
  id: string
  type: string
  status: 'pending' | 'completed'
  createdAt: number
  subject?: string
  to?: string
  risk?: string
  command?: string
}

const TYPE_LABELS: Record<string, string> = {
  email_review:     'Email',
  code_review:      'Code',
  action_approval:  'Approval',
  form_review:      'Form',
  selection_review: 'Selection',
}

function sessionPath(s: SessionItem): string {
  if (s.type === 'action_approval') return `/approval/${s.id}`
  if (s.type === 'code_review') return `/code-review/${s.id}`
  if (s.type === 'form_review') return `/form-review/${s.id}`
  if (s.type === 'selection_review') return `/selection/${s.id}`
  return `/review/${s.id}`
}

function sessionTitle(s: SessionItem): string {
  if (s.subject) return s.subject
  if (s.type === 'code_review' && s.command) return s.command
  return TYPE_LABELS[s.type] ?? s.type
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diffMs = now - ts
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString()
}

const DANGEROUS_COMMANDS = ['rm', 'drop', 'delete', 'format', 'truncate', 'fdisk', 'mkfs']

function sessionRisk(s: SessionItem): 'danger' | 'warning' | 'normal' {
  if (s.type === 'code_review' && s.command) {
    const cmd = s.command.toLowerCase()
    if (DANGEROUS_COMMANDS.some(d => cmd.includes(d))) return 'danger'
  }
  if (s.type === 'action_approval') {
    if (s.risk === 'high') return 'danger'
    if (s.risk === 'medium') return 'warning'
  }
  return 'normal'
}

function riskBadge(risk: 'danger' | 'warning' | 'normal') {
  if (risk === 'danger') return (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-50 dark:bg-red-950 text-red-500">Dangerous</span>
  )
  if (risk === 'warning') return (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-50 dark:bg-amber-950 text-amber-600">Medium Risk</span>
  )
  return null
}

export default function HomePage() {
  const navigate = useNavigate()
  const [pending, setPending] = useState<SessionItem[]>([])
  const [completedCount, setCompletedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [prefCount, setPrefCount] = useState<number | null>(null)

  const pendingIdsRef = useRef<string>('')

  const fetchSessions = useCallback((initial = false) => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then((data: SessionItem[]) => {
        const nextPending = data.filter(s => s.status === 'pending')
        const nextIds = nextPending.map(s => s.id).join(',')
        // Only update state if pending list actually changed
        if (initial || nextIds !== pendingIdsRef.current) {
          pendingIdsRef.current = nextIds
          setPending(nextPending)
          setCompletedCount(data.filter(s => s.status === 'completed').length)
        }
        if (initial) setLoading(false)
      })
      .catch(() => { if (initial) setLoading(false) })
  }, [])

  useEffect(() => {
    fetchSessions(true)

    fetch('/api/preferences')
      .then(r => r.json())
      .then(data => setPrefCount((data.preferences ?? []).length))
      .catch(() => {})

    const INTERVAL = 5000
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => { timer = setInterval(() => fetchSessions(), INTERVAL) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }

    // Only poll when tab is visible
    const onVisibility = () => document.visibilityState === 'visible' ? start() : stop()
    document.addEventListener('visibilitychange', onVisibility)

    if (document.visibilityState === 'visible') start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchSessions])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto py-10 px-4">

        <div className="mb-8">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">agentclick</p>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">Pending</h1>
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/completed')}
                className="flex items-center gap-1.5 text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors"
              >
                Completed
                {completedCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 font-medium">{completedCount}</span>
                )}
                <span className="text-zinc-300 dark:text-zinc-600">›</span>
              </button>
              <button
                onClick={() => navigate('/preferences')}
                className="flex items-center gap-1.5 text-sm text-blue-400 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              >
                Preferences
                {prefCount !== null && prefCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 font-medium">{prefCount}</span>
                )}
                <span className="text-zinc-300 dark:text-zinc-600">›</span>
              </button>
            </div>
          </div>
        </div>

        {loading && (
          <p className="text-sm text-zinc-400 dark:text-slate-500">Loading...</p>
        )}

        {!loading && pending.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-zinc-400 dark:text-slate-500 mb-1">Nothing waiting for you.</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600">Your agent will open a tab when a review is needed.</p>
          </div>
        )}

        {!loading && pending.length > 0 && (
          <div className="space-y-2">
            {pending.map(s => {
              const risk = sessionRisk(s)
              const borderClass = risk === 'danger' ? 'border-l-4 border-l-red-400' :
                                  risk === 'warning' ? 'border-l-4 border-l-amber-400' : ''
              return (
                <Link
                  key={s.id}
                  to={sessionPath(s)}
                  className={`flex items-center justify-between p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg hover:border-gray-200 dark:hover:border-zinc-700 transition-colors ${borderClass}`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium shrink-0">
                      {TYPE_LABELS[s.type] ?? s.type}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-slate-200 truncate">
                        {sessionTitle(s)}
                      </p>
                      {s.to && (
                        <p className="text-xs text-zinc-400 dark:text-slate-500 mt-0.5 truncate">To: {s.to}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {riskBadge(risk)}
                    <span className="text-xs text-zinc-400 dark:text-slate-500">{formatTime(s.createdAt)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
