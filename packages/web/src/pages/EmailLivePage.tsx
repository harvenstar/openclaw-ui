import { useState } from 'react'

export default function EmailLivePage() {
  const [creating, setCreating] = useState(false)
  const [count, setCount] = useState(10)
  const [error, setError] = useState('')

  const createSession = async () => {
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/gmail/review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max: count }),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Live Gmail review failed: ${response.status}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto py-16 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Email Live</p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-slate-100">Live Gmail Review</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-slate-400">
          Opens a real Gmail-backed email review session in AgentClick UI and starts the live monitor.
        </p>

        <div className="mt-6 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Unread emails to load</label>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={e => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 10)))}
              className="w-32 text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300"
            />
          </div>
          <button
            onClick={createSession}
            disabled={creating}
            className="px-4 py-2 text-sm rounded-lg font-medium bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50"
          >
            {creating ? 'Opening Gmail Review...' : 'Open Live Gmail Review'}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  )
}
