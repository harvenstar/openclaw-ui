import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface Paragraph {
  id: string
  content: string
}

interface EmailPayload {
  to: string
  subject: string
  paragraphs: Paragraph[]
}

interface Action {
  type: 'delete' | 'rewrite'
  paragraphId: string
  reason?: string
  instruction?: string
}

type ParagraphState = 'normal' | 'deleted' | 'rewriting'

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [payload, setPayload] = useState<EmailPayload | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [states, setStates] = useState<Record<string, ParagraphState>>({})
  const [rewriteInput, setRewriteInput] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`http://localhost:3001/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as EmailPayload)
        setLoading(false)
      })
  }, [id])

  const deleteParagraph = (pid: string, reason: string) => {
    setStates(s => ({ ...s, [pid]: 'deleted' }))
    setActions(a => [...a.filter(x => x.paragraphId !== pid), { type: 'delete', paragraphId: pid, reason }])
  }

  const startRewrite = (pid: string) => {
    setStates(s => ({ ...s, [pid]: 'rewriting' }))
  }

  const confirmRewrite = (pid: string) => {
    const instruction = rewriteInput[pid]
    if (!instruction) return
    setStates(s => ({ ...s, [pid]: 'deleted' }))
    setActions(a => [...a.filter(x => x.paragraphId !== pid), { type: 'rewrite', paragraphId: pid, instruction }])
  }

  const undoParagraph = (pid: string) => {
    setStates(s => ({ ...s, [pid]: 'normal' }))
    setActions(a => a.filter(x => x.paragraphId !== pid))
  }

  const submit = async (confirmed: boolean) => {
    await fetch(`http://localhost:3001/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions, confirmed, regenerate: !confirmed })
    })
    setSubmitted(true)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400">Loading draft...</p>
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
        <p className="text-gray-700 font-medium">Done. Your agent is continuing.</p>
        <p className="text-gray-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  const hasActions = actions.length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Email Draft Review</p>
          <h1 className="text-xl font-semibold text-gray-800">{payload.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">To: {payload.to}</p>
        </div>

        {/* Paragraphs */}
        <div className="space-y-3 mb-8">
          {payload.paragraphs.map(p => {
            const state = states[p.id] || 'normal'

            if (state === 'deleted') return (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-lg opacity-60">
                <span className="text-sm text-red-400 line-through flex-1">{p.content}</span>
                <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600">undo</button>
              </div>
            )

            if (state === 'rewriting') return (
              <div key={p.id} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-gray-500 mb-2">{p.content}</p>
                <input
                  className="w-full text-sm border border-blue-200 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="How should it be rewritten? (e.g. more direct, no formalities)"
                  value={rewriteInput[p.id] || ''}
                  onChange={e => setRewriteInput(r => ({ ...r, [p.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">Confirm</button>
                  <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                </div>
              </div>
            )

            return (
              <div key={p.id} className="group relative flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors">
                <p className="text-sm text-gray-700 flex-1 leading-relaxed">{p.content}</p>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => startRewrite(p.id)}
                    title="Rewrite"
                    className="text-xs text-gray-300 hover:text-blue-500 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors"
                  >Rewrite</button>
                  <DeleteButton onConfirm={(reason) => deleteParagraph(p.id, reason)} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Actions summary */}
        {hasActions && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
            {actions.length} change{actions.length > 1 ? 's' : ''} marked
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => submit(true)}
            className="flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Confirm & Send
          </button>
          <button
            onClick={() => submit(false)}
            className="px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteButton({ onConfirm }: { onConfirm: (reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const reasons = ['Too formal', 'Too casual', 'Irrelevant', 'Wrong tone', 'Other']

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      title="Delete"
      className="text-xs text-gray-300 hover:text-red-400 px-1.5 py-1 rounded hover:bg-red-50 transition-colors"
    >Delete</button>
  )

  return (
    <div className="absolute z-10 top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-sm p-1.5 min-w-[140px]">
      <p className="text-xs text-gray-400 mb-1 px-2 pt-0.5">Why remove this?</p>
      {reasons.map(r => (
        <button
          key={r}
          onClick={() => { onConfirm(r); setOpen(false) }}
          className="block w-full text-left text-xs px-2 py-1.5 hover:bg-gray-50 rounded text-gray-600 transition-colors"
        >{r}</button>
      ))}
      <button
        onClick={() => setOpen(false)}
        className="block w-full text-left text-xs px-2 py-1.5 text-gray-300 hover:text-gray-500 transition-colors"
      >Cancel</button>
    </div>
  )
}
