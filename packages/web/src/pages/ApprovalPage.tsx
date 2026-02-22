import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface ApprovalPayload {
  action: string
  detail: string
  risk: 'low' | 'medium' | 'high'
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

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>()
  const [payload, setPayload] = useState<ApprovalPayload | null>(null)
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`http://localhost:3001/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as ApprovalPayload)
        setLoading(false)
      })
  }, [id])

  const submit = async (approved: boolean) => {
    await fetch(`http://localhost:3001/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, note })
    })
    setSubmitted(true)
  }

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
        <p className="text-zinc-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Action Approval</p>
          <h1 className="text-xl font-semibold text-zinc-900">{payload.action}</h1>
          <div className="mt-2">
            <RiskBadge risk={payload.risk} />
          </div>
        </div>

        {/* Detail */}
        <div className="mb-6 p-4 bg-white border border-gray-100 rounded-lg">
          <p className="text-sm text-zinc-700 leading-relaxed">{payload.detail}</p>
        </div>

        {/* Note */}
        <div className="mb-6">
          <textarea
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            placeholder="Add a note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => submit(true)}
            className="flex-1 bg-zinc-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => submit(false)}
            className="px-5 text-sm text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            Reject
          </button>
        </div>

      </div>
    </div>
  )
}
