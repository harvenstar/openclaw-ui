import { useEffect, useState } from 'react'
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


function sessionPath(s: SessionItem): string {
  if (s.type === 'action_approval') return `/approval/${s.id}`
  if (s.type === 'code_review') return `/code-review/${s.id}`
  return `/review/${s.id}`
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
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [prefCount, setPrefCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(data => { setSessions(data); setLoading(false) })
      .catch(() => setLoading(false))

    fetch('/api/preferences')
      .then(r => r.json())
      .then(data => setPrefCount((data.preferences ?? []).length))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto py-10 px-4">

        <div className="mb-6">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">agentclick</p>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">Recent Sessions</h1>
        </div>

        {loading && (
          <p className="text-sm text-zinc-400 dark:text-slate-500">Loading...</p>
        )}

        {!loading && sessions.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-slate-500">No sessions yet.</p>
        )}

        {!loading && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map(s => {
              const risk = sessionRisk(s)
              const borderClass = risk === 'danger' ? 'border-l-4 border-l-red-400' :
                                  risk === 'warning' ? 'border-l-4 border-l-amber-400' : ''
              return (
                <Link
                  key={s.id}
                  to={sessionPath(s)}
                  className={`flex items-center justify-between p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg hover:border-gray-200 dark:hover:border-zinc-700 transition-colors ${borderClass}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800 dark:text-slate-200 truncate">
                      {s.subject ?? s.type}
                    </p>
                    {s.to && (
                      <p className="text-xs text-zinc-400 dark:text-slate-500 mt-0.5 truncate">To: {s.to}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {riskBadge(risk)}
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      s.status === 'completed'
                        ? 'bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-500'
                        : 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                    }`}>
                      {s.status}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-slate-500">{formatTime(s.createdAt)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        {/* Preferences disclosure row */}
        <div className="mt-8 border-t border-gray-100 dark:border-zinc-800 pt-4">
          <button
            onClick={() => navigate('/preferences')}
            className="w-full flex items-center justify-between py-2 group"
          >
            <span className="text-sm text-zinc-500 dark:text-slate-400 group-hover:text-zinc-700 dark:group-hover:text-slate-200 transition-colors">
              Learned Preferences
            </span>
            <div className="flex items-center gap-2">
              {prefCount !== null && prefCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 font-medium">
                  {prefCount}
                </span>
              )}
              <span className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors text-sm">›</span>
            </div>
          </button>
        </div>

      </div>
    </div>
  )
}
