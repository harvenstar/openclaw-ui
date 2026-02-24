import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface FormField {
  key: string
  label: string
  value: string
  editable?: boolean
  options?: string[]
}

interface FormPayload {
  title: string
  description?: string
  fields: FormField[]
  risk?: 'low' | 'medium' | 'high'
}

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low: 'bg-green-50 text-green-700 border border-green-200',
    medium: 'bg-amber-50 text-amber-700 border border-amber-200',
    high: 'bg-red-50 text-red-500 border border-red-200',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${styles[risk]}`}>
      {risk} risk
    </span>
  )
}

export default function FormReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [payload, setPayload] = useState<FormPayload | null>(null)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
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
        const nextPayload = data.payload as FormPayload
        setPayload(nextPayload)
        const initialValues: Record<string, string> = {}
        for (const field of nextPayload.fields ?? []) {
          initialValues[field.key] = field.value
        }
        setFieldValues(initialValues)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  const setFieldValue = (key: string, value: string) => {
    setFieldValues(current => ({ ...current, [key]: value }))
  }

  const submit = async (approved: boolean) => {
    if (!payload) return
    setSubmitting(true)
    const fields = payload.fields.map(field => ({ key: field.key, value: fieldValues[field.key] ?? field.value }))
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, fields, note }),
    }).then(r => r.json())
    if (result.callbackFailed) setCallbackFailed(true)
    setSubmitted(true)
  }

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-red-400 text-sm">Server not reachable — is AgentClick running?</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-zinc-400">Loading...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-red-400">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-700 font-medium">Done. Your agent is continuing.</p>
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-zinc-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="mb-6">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Form Review</p>
          <h1 className="text-xl font-semibold text-zinc-900">{payload.title}</h1>
          {payload.risk && (
            <div className="mt-2">
              <RiskBadge risk={payload.risk} />
            </div>
          )}
          {payload.description && (
            <p className="text-sm text-zinc-500 mt-2">{payload.description}</p>
          )}
        </div>

        <div className="mb-6 p-4 bg-white border border-gray-100 rounded-lg">
          <div className="space-y-4">
            {payload.fields.map(field => {
              const editable = field.editable !== false
              return (
                <div key={field.key} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <p className="text-sm text-zinc-500">{field.label}</p>
                  {editable ? (
                    field.options && field.options.length > 0 ? (
                      <select
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={fieldValues[field.key] ?? field.value}
                        onChange={e => setFieldValue(field.key, e.target.value)}
                      >
                        {field.options.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={fieldValues[field.key] ?? field.value}
                        onChange={e => setFieldValue(field.key, e.target.value)}
                      />
                    )
                  ) : (
                    <p className="text-sm text-zinc-700 break-all">{field.value}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="mb-6">
          <textarea
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            placeholder="Add a note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className={`flex-1 bg-zinc-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-zinc-700 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Approve
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-5 text-sm text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
