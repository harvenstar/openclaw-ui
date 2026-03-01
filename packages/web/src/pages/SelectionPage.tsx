import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

interface SelectionOption {
  id: string
  title: string
  detail?: string
  recommended?: boolean
}

interface SelectionPayload {
  question: string
  description?: string
  options: SelectionOption[]
  multiSelect?: boolean
}

export default function SelectionPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<SelectionPayload | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as SelectionPayload)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  const toggleSelection = (optionId: string) => {
    if (!payload) return
    if (payload.multiSelect) {
      setSelectedIds(current => (
        current.includes(optionId)
          ? current.filter(id => id !== optionId)
          : [...current, optionId]
      ))
      return
    }
    setSelectedIds(current => (current[0] === optionId ? [] : [optionId]))
  }

  const submit = async () => {
    setSubmitting(true)
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedIds, note }),
    }).then(r => r.json())
    if (result.callbackFailed) {
      setCallbackFailed(true)
      setSubmitted(true)
      setTimeout(() => navigate('/'), 1500)
    } else {
      navigate('/')
    }
  }

  if (error) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
      <p className="text-red-400 text-sm">Server not reachable — is AgentClick running?</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
      <p className="text-zinc-400 dark:text-slate-500">Loading...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
      <p className="text-red-400">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-700 dark:text-slate-200 font-medium">Done. Your agent is continuing.</p>
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-zinc-400 dark:text-slate-500 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="mb-6">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Selection Review</p>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">{payload.question}</h1>
          {payload.description && (
            <p className="text-sm text-zinc-500 dark:text-slate-400 mt-2">{payload.description}</p>
          )}
        </div>

        <div className="mb-6 space-y-2">
          {payload.options.map(option => {
            const selected = selectedIds.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleSelection(option.id)}
                className={`w-full text-left p-4 border rounded-lg transition-colors ${
                  selected
                    ? 'border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950'
                    : 'border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-200 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-slate-200">{option.title}</p>
                  {option.recommended && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">Recommended</span>
                  )}
                </div>
                {option.detail && (
                  <p className="text-xs text-zinc-500 dark:text-slate-400">{option.detail}</p>
                )}
              </button>
            )
          })}
        </div>

        <div className="mb-4">
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-zinc-700 dark:text-slate-300 bg-white dark:bg-slate-800 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            placeholder="Add a note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={submitting || selectedIds.length === 0}
            className={`flex-1 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium py-2.5 rounded-lg hover:bg-zinc-700 dark:hover:bg-slate-200 transition-colors ${
              submitting || selectedIds.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
