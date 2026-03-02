import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface LearnedPreference {
  description: string
  reason: string
  scope: string
}

const REASON_COLORS: Record<string, string> = {
  too_formal:   'bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400',
  too_casual:   'bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400',
  wrong_tone:   'bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400',
  too_polite:   'bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400',
  too_long:     'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400',
  off_topic:    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  redundant:    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  repetitive:   'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  unnecessary:  'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  inaccurate:   'bg-red-50 dark:bg-red-950 text-red-500 dark:text-red-400',
}

function reasonColor(reason: string): string {
  const key = reason.toLowerCase().replace(/ /g, '_')
  return REASON_COLORS[key] ?? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
}

export default function PreferencesPage() {
  const navigate = useNavigate()
  const [preferences, setPreferences] = useState<LearnedPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then(data => { setPreferences(data.preferences ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const deleteOne = async (index: number) => {
    setDeletingIndex(index)
    await fetch(`/api/preferences/${index}`, { method: 'DELETE' }).catch(() => {})
    setPreferences(p => p.filter((_, i) => i !== index))
    setDeletingIndex(null)
  }

  const clearAll = async () => {
    setClearing(true)
    await fetch('/api/preferences', { method: 'DELETE' }).catch(() => {})
    setPreferences([])
    setClearing(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {/* Back + Header */}
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors"
          >
            ← Back
          </button>
        </div>
        <div className="mb-8">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1 font-medium">agentclick</p>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">Learned Preferences</h1>
          <p className="text-sm text-zinc-500 dark:text-slate-400 mt-1">
            Learned from paragraphs you deleted while reviewing drafts. Shared with your agent via MEMORY.md.
          </p>
        </div>

        {loading && (
          <p className="text-sm text-zinc-400 dark:text-slate-500">Loading...</p>
        )}

        {!loading && preferences.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-zinc-400 dark:text-slate-500 mb-1">No preferences learned yet.</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-600">
              Delete draft paragraphs with a reason to teach AgentClick your writing style.
            </p>
          </div>
        )}

        {!loading && preferences.length > 0 && (
          <>
            <div className="space-y-2 mb-8">
              {preferences.map((pref, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg"
                >
                  <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 mt-0.5 ${reasonColor(pref.reason)}`}>
                    {pref.reason.replace(/_/g, ' ')}
                  </span>
                  <p className="text-sm text-zinc-600 dark:text-slate-300 leading-relaxed flex-1">{pref.description}</p>
                  <button
                    onClick={() => deleteOne(i)}
                    disabled={deletingIndex === i}
                    className="shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-red-400 dark:hover:text-red-400 transition-colors text-sm leading-none mt-0.5"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={clearAll}
              disabled={clearing}
              className={`text-sm text-red-400 hover:text-red-500 transition-colors ${clearing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {clearing ? 'Clearing...' : `Clear all ${preferences.length} rule${preferences.length > 1 ? 's' : ''}`}
            </button>
          </>
        )}

      </div>
    </div>
  )
}
