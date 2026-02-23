import { useEffect, useRef, useState } from 'react'
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

interface EmailItem {
  id: string
  from: string
  subject: string
  preview: string
  category: 'Personal' | 'Work' | 'ADS' | string
  timestamp: number
}

interface InboxPayload {
  inbox: EmailItem[]
  draft: {
    replyTo: string
    to: string
    subject: string
    paragraphs: Paragraph[]
  }
}

interface Action {
  type: 'delete' | 'rewrite'
  paragraphId: string
  reason?: string
  instruction?: string
}

type ParagraphState = 'normal' | 'deleted' | 'rewriting'

// Keys must match REASON_LABELS in preference.ts
const REASONS = [
  { key: 'too_formal',  label: 'Too formal' },
  { key: 'too_casual',  label: 'Too casual' },
  { key: 'too_long',    label: 'Too long' },
  { key: 'wrong_tone',  label: 'Wrong tone' },
  { key: 'off_topic',   label: 'Off topic' },
  { key: 'redundant',   label: 'Redundant' },
]

function reasonLabel(key: string): string {
  return REASONS.find(r => r.key === key)?.label ?? key
}

function categoryBadge(category: string) {
  if (category === 'Personal') return 'bg-green-100 text-green-700'
  if (category === 'ADS') return 'bg-amber-100 text-amber-700'
  if (category === 'Work') return 'bg-zinc-100 text-zinc-600'
  return 'bg-zinc-100 text-zinc-500'
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 24) return diffH < 1 ? 'now' : `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return diffD < 7 ? `${diffD}d ago` : d.toLocaleDateString()
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [payload, setPayload] = useState<EmailPayload | InboxPayload | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [states, setStates] = useState<Record<string, ParagraphState>>({})
  const [rewriteInput, setRewriteInput] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)

  // Format B state
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [rightView, setRightView] = useState<'draft' | 'summary' | 'empty'>('empty')
  const [markedAsRead, setMarkedAsRead] = useState<string[]>([])
  const [userIntention, setUserIntention] = useState('')
  const [cc, setCc] = useState('')
  const [summaryEmail, setSummaryEmail] = useState<EmailItem | null>(null)

  useEffect(() => {
    fetch(`http://localhost:3001/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as EmailPayload | InboxPayload)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  // Cmd+Enter to confirm & send
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitting && !submitted) {
        e.preventDefault()
        submit(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [submitting, submitted])

  const deleteParagraph = (pid: string, reasonKey: string) => {
    setStates(s => ({ ...s, [pid]: 'deleted' }))
    setActions(a => [...a.filter(x => x.paragraphId !== pid), { type: 'delete', paragraphId: pid, reason: reasonKey }])
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

  const handleReply = (email: EmailItem) => {
    setSelectedEmailId(email.id)
    setRightView('draft')
  }

  const handleMarkAsRead = (emailId: string) => {
    setMarkedAsRead(r => [...r, emailId])
    if (selectedEmailId === emailId) {
      setSelectedEmailId(null)
      setRightView('empty')
    }
  }

  const handleSummary = (email: EmailItem) => {
    setSummaryEmail(email)
    setRightView('summary')
  }

  const submit = async (confirmed: boolean) => {
    setSubmitting(true)
    const hasInbox = payload && 'inbox' in payload && Array.isArray((payload as InboxPayload).inbox)
    const body = hasInbox
      ? JSON.stringify({ actions, confirmed, regenerate: !confirmed, markedAsRead, userIntention, cc })
      : JSON.stringify({ actions, confirmed, regenerate: !confirmed })
    const result = await fetch(`http://localhost:3001/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-gray-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  const hasInbox = payload && 'inbox' in payload && Array.isArray((payload as InboxPayload).inbox)

  // Format B — two-column layout
  if (hasInbox) {
    const inboxPayload = payload as InboxPayload
    const visibleEmails = inboxPayload.inbox.filter(e => !markedAsRead.includes(e.id)).slice(0, 10)
    const hasActions = actions.length > 0

    const renderParagraphs = (paragraphs: Paragraph[]) =>
      paragraphs.map(p => {
        const state = states[p.id] || 'normal'
        const action = actions.find(a => a.paragraphId === p.id)

        if (state === 'deleted') return (
          <div key={p.id} className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
              {action?.reason && (
                <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 px-1.5 py-0.5 rounded">
                  {reasonLabel(action.reason)}
                </span>
              )}
            </div>
            <button
              onClick={() => undoParagraph(p.id)}
              className="text-xs text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
            >
              undo
            </button>
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
              <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors">Confirm</button>
              <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
            </div>
          </div>
        )

        return (
          <div key={p.id} className="group relative flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors">
            <p className="text-sm text-gray-700 flex-1 leading-relaxed">{p.content}</p>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => startRewrite(p.id)}
                className="text-xs text-gray-300 hover:text-blue-500 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors"
              >
                Rewrite
              </button>
              <DeleteButton onConfirm={(reasonKey) => deleteParagraph(p.id, reasonKey)} />
            </div>
          </div>
        )
      })

    return (
      <div className="min-h-screen bg-gray-50 flex">
        {/* Left Panel — Inbox List */}
        <div className="w-72 shrink-0 bg-white border-r border-gray-100 overflow-y-auto">
          {visibleEmails.length === 0 ? (
            <p className="text-sm text-zinc-400 p-4">No unread emails.</p>
          ) : (
            visibleEmails.map(email => {
              const isSelected = selectedEmailId === email.id
              return (
                <div
                  key={email.id}
                  className={`group relative p-4 cursor-pointer border-b border-gray-50 transition-colors ${
                    isSelected
                      ? 'bg-zinc-50 border-l-2 border-l-blue-500'
                      : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleReply(email)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${categoryBadge(email.category)}`}>
                      {email.category}
                    </span>
                    <span className="text-sm font-medium text-zinc-800 truncate flex-1 min-w-0">{email.from}</span>
                    {/* Hover actions — inline so from text truncates around them */}
                    <div className="hidden group-hover:flex items-center gap-2 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); handleReply(email) }}
                        className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
                      >
                        Reply
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleMarkAsRead(email.id) }}
                        className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                      >
                        Read
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleSummary(email) }}
                        className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                      >
                        Summary
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 truncate mb-0.5">{email.subject}</p>
                  <p className="text-xs text-zinc-400 line-clamp-2">{email.preview}</p>
                  <p className="text-xs text-zinc-300 mt-1">{formatTimestamp(email.timestamp)}</p>
                </div>
              )
            })
          )}
        </div>

        {/* Right Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto py-10 px-4">

            {/* View: empty */}
            {rightView === 'empty' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-zinc-400">Select an email to review the draft.</p>
              </div>
            )}

            {/* View: summary */}
            {rightView === 'summary' && summaryEmail && (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <button
                    onClick={() => setRightView(selectedEmailId ? 'draft' : 'empty')}
                    className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
                  >
                    Back
                  </button>
                  <span className="text-zinc-300">/</span>
                  <span className="text-sm text-zinc-600 font-medium">Summary</span>
                </div>
                <div className="border-t border-gray-100 pt-6">
                  <h2 className="text-base font-medium text-zinc-800 mb-1">{summaryEmail.subject}</h2>
                  <p className="text-xs text-zinc-500 mb-4">From: {summaryEmail.from}</p>
                  <p className="text-sm text-zinc-700 leading-relaxed">{summaryEmail.preview}</p>
                  <p className="text-xs text-zinc-300 mt-4">Summary via agent</p>
                </div>
              </div>
            )}

            {/* View: draft */}
            {rightView === 'draft' && (
              <div>
                {/* Header */}
                <div className="mb-6">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Email Draft Review</p>
                  <h1 className="text-xl font-semibold text-gray-800">{inboxPayload.draft.subject}</h1>
                  <p className="text-sm text-gray-500 mt-1">To: {inboxPayload.draft.to}</p>
                </div>

                {/* Paragraphs */}
                <div className="space-y-3 mb-8">
                  {renderParagraphs(inboxPayload.draft.paragraphs)}
                </div>

                {/* Actions summary */}
                {hasActions && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
                    {actions.length} change{actions.length > 1 ? 's' : ''} marked
                  </div>
                )}

                {/* User Intention */}
                <div className="mb-3">
                  <label className="block text-xs text-zinc-500 mb-1">What do you want to do? (optional)</label>
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="e.g. CC Hanwen, agree to the delay, keep it brief"
                    value={userIntention}
                    onChange={e => setUserIntention(e.target.value)}
                  />
                </div>

                {/* CC */}
                <div className="mb-6">
                  <label className="block text-xs text-zinc-500 mb-1">CC</label>
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="e.g. hanwen@company.com"
                    value={cc}
                    onChange={e => setCc(e.target.value)}
                  />
                </div>

                {/* Footer buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => submit(true)}
                    disabled={submitting}
                    className={`flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Confirm & Send
                  </button>
                  <button
                    onClick={() => submit(false)}
                    disabled={submitting}
                    className={`px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    )
  }

  // Format A — legacy single-column layout (unchanged)
  const legacyPayload = payload as EmailPayload
  const hasActions = actions.length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Email Draft Review</p>
          <h1 className="text-xl font-semibold text-gray-800">{legacyPayload.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">To: {legacyPayload.to}</p>
        </div>

        {/* Paragraphs */}
        <div className="space-y-3 mb-8">
          {legacyPayload.paragraphs.map(p => {
            const state = states[p.id] || 'normal'
            const action = actions.find(a => a.paragraphId === p.id)

            if (state === 'deleted') return (
              <div key={p.id} className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
                  {action?.reason && (
                    <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 px-1.5 py-0.5 rounded">
                      {reasonLabel(action.reason)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => undoParagraph(p.id)}
                  className="text-xs text-gray-400 hover:text-gray-600 shrink-0 transition-colors"
                >
                  undo
                </button>
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
                  <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors">Confirm</button>
                  <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
                </div>
              </div>
            )

            return (
              <div key={p.id} className="group relative flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors">
                <p className="text-sm text-gray-700 flex-1 leading-relaxed">{p.content}</p>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => startRewrite(p.id)}
                    className="text-xs text-gray-300 hover:text-blue-500 px-1.5 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    Rewrite
                  </button>
                  <DeleteButton onConfirm={(reasonKey) => deleteParagraph(p.id, reasonKey)} />
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
            disabled={submitting}
            className={`flex-1 bg-gray-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-gray-700 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Confirm & Send
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteButton({ onConfirm }: { onConfirm: (reasonKey: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false)
        return
      }
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler as EventListener)
    document.addEventListener('keydown', handler as EventListener)
    return () => {
      document.removeEventListener('mousedown', handler as EventListener)
      document.removeEventListener('keydown', handler as EventListener)
    }
  }, [open])

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="text-xs text-gray-300 hover:text-red-400 px-1.5 py-1 rounded hover:bg-red-50 transition-colors"
    >
      Delete
    </button>
  )

  return (
    <div ref={ref} className="absolute z-10 top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-sm p-1.5 min-w-[148px]">
      <p className="text-xs text-gray-400 mb-1 px-2 pt-0.5">Why remove this?</p>
      {REASONS.map(r => (
        <button
          key={r.key}
          onClick={() => { onConfirm(r.key); setOpen(false) }}
          className="block w-full text-left text-xs px-2 py-1.5 hover:bg-gray-50 rounded text-gray-600 transition-colors"
        >
          {r.label}
        </button>
      ))}
      <div className="border-t border-gray-100 mt-1 pt-1">
        <button
          onClick={() => setOpen(false)}
          className="block w-full text-left text-xs px-2 py-1.5 text-gray-300 hover:text-gray-500 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
