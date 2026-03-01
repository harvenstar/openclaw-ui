import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

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

interface CcSuggestion {
  name: string
  email: string
}

interface IntentSuggestion {
  id: string
  text: string
}

interface InboxPayload {
  inbox: EmailItem[]
  draft: {
    replyTo: string
    to: string
    subject: string
    paragraphs: Paragraph[]
    ccSuggestions?: CcSuggestion[]
    intentSuggestions?: IntentSuggestion[]
  }
}

interface Action {
  type: 'delete' | 'rewrite'
  paragraphId: string
  reason?: string
  instruction?: string
}

interface SummaryResponse {
  emailId?: string
  summary: string
  bullets?: string[]
  confidence?: string
  error?: string
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
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${dateStr}, ${timeStr}`
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<EmailPayload | InboxPayload | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [states, setStates] = useState<Record<string, ParagraphState>>({})
  const [rewriteInput, setRewriteInput] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)
  const [waitingForRewrite, setWaitingForRewrite] = useState(false)
  const revisionRef = useRef(0)

  // Format B state
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [rightView, setRightView] = useState<'draft' | 'summary' | 'email' | 'empty'>('empty')
  const [markedAsRead, setMarkedAsRead] = useState<string[]>([])
  const [userIntention, setUserIntention] = useState('')
  const [selectedIntents, setSelectedIntents] = useState<Record<string, boolean>>({})
  const [summaryEmail, setSummaryEmail] = useState<EmailItem | null>(null)
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const resetEditState = useCallback(() => {
    setActions([])
    setStates({})
    setRewriteInput({})
    setUserIntention('')
    setSelectedIntents({})
    setSubmitting(false)
  }, [])

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as EmailPayload | InboxPayload)
        revisionRef.current = data.revision ?? 0
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  // Poll for payload updates while waiting for agent rewrite
  useEffect(() => {
    if (!waitingForRewrite) return
    const interval = setInterval(async () => {
      try {
        const data = await fetch(`/api/sessions/${id}`).then(r => r.json())
        if (data.revision > revisionRef.current) {
          revisionRef.current = data.revision
          setPayload(data.payload as EmailPayload | InboxPayload)
          resetEditState()
          setWaitingForRewrite(false)
          setRightView('draft')
        }
      } catch { /* ignore polling errors */ }
    }, 1500)
    return () => clearInterval(interval)
  }, [waitingForRewrite, id, resetEditState])

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

  const handleViewEmail = (email: EmailItem) => {
    setSelectedEmailId(email.id)
    setRightView('email')
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

  const handleSummary = async (email: EmailItem) => {
    setSummaryEmail(email)
    setSummaryLoading(true)
    setSummaryError(null)
    setSummaryData(null)
    setRightView('summary')
    try {
      const result = await fetch(`/api/sessions/${id}/summary?emailId=${encodeURIComponent(email.id)}`)
        .then(r => r.json() as Promise<SummaryResponse>)
      if (result.error) {
        setSummaryError(result.error)
        return
      }
      setSummaryData(result)
    } catch {
      setSummaryError('Summary service unavailable')
    } finally {
      setSummaryLoading(false)
    }
  }

  const submit = async (confirmed: boolean) => {
    setSubmitting(true)
    const hasInbox = payload && 'inbox' in payload && Array.isArray((payload as InboxPayload).inbox)
    const selectedIntentsList = Object.keys(selectedIntents).map(intentId => ({ id: intentId, accepted: true }))
    const body = hasInbox
      ? JSON.stringify({
          actions,
          confirmed,
          regenerate: !confirmed,
          markedAsRead,
          userIntention,
          selectedIntents: selectedIntentsList,
        })
      : JSON.stringify({ actions, confirmed, regenerate: !confirmed })
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then(r => r.json())

    if (!confirmed && result.rewriting) {
      // Regenerate: wait for agent to update payload
      setWaitingForRewrite(true)
      setSubmitting(false)
      return
    }

    // Confirmed or rejected (non-regenerate): navigate home
    if (result.callbackFailed) {
      setCallbackFailed(true)
      setSubmitted(true)
      setTimeout(() => navigate('/'), 1500)
    } else {
      navigate('/')
    }
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
    const intentSuggestions = inboxPayload.draft.intentSuggestions ?? []
    const effectiveRightView = rightView === 'empty' && visibleEmails.length === 0 ? 'draft' : rightView

    const toggleIntent = (intentId: string) => {
      setSelectedIntents(current => {
        if (current[intentId]) {
          const { [intentId]: _, ...rest } = current
          return rest
        }
        return { ...current, [intentId]: true }
      })
    }

    const renderParagraphs = (paragraphs: Paragraph[]) =>
      paragraphs.map(p => {
        const state = states[p.id] || 'normal'
        const action = actions.find(a => a.paragraphId === p.id)

        if (state === 'deleted') return (
          <div key={p.id} className="space-y-1">
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
                {action?.reason && (
                  <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 px-1.5 py-0.5 rounded">
                    {reasonLabel(action.reason)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => undoParagraph(p.id)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded px-1"
              >
                undo
              </button>
            </div>
          </div>
        )

        if (state === 'rewriting') return (
          <div key={p.id} className="space-y-1">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-gray-500 mb-2 whitespace-pre-wrap">{p.content}</p>
              <input
                className="w-full text-sm border border-blue-200 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="How should it be rewritten? (e.g. more direct, no formalities)"
                value={rewriteInput[p.id] || ''}
                onChange={e => setRewriteInput(r => ({ ...r, [p.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300">Confirm</button>
                <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded">Cancel</button>
              </div>
            </div>
          </div>
        )

        return (
          <div key={p.id} className="space-y-1">
            <div className="p-4 bg-white border border-gray-100 rounded-lg">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{p.content}</p>
            </div>
            <div className="flex justify-end gap-1">
              <button
                onClick={() => startRewrite(p.id)}
                style={{ color: '#457B9D' }}
                className="text-xs font-medium px-2 py-1 rounded transition-opacity hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-1"
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
                  className={`p-4 cursor-pointer border-b border-gray-50 transition-colors ${
                    isSelected
                      ? 'border-l-2'
                      : 'hover:bg-gray-50'
                  }`}
                  style={isSelected ? { backgroundColor: '#F1FAEE', borderLeftColor: '#457B9D' } : {}}
                  onClick={() => handleViewEmail(email)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${categoryBadge(email.category)}`}>
                      {email.category}
                    </span>
                    <span className="text-sm font-medium text-zinc-800 truncate flex-1 min-w-0">{email.from}</span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate mb-0.5">{email.subject}</p>
                  <p className="text-xs text-zinc-400 line-clamp-2 mb-2">{email.preview}</p>
                  {/* Line 1: action buttons */}
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {/* Reply — primary: dark navy fill */}
                    <button
                      onClick={e => { e.stopPropagation(); handleReply(email) }}
                      className="text-xs font-semibold px-3 py-1 rounded-full transition-all hover:shadow-md active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                      style={{ backgroundColor: '#1D3557', color: '#F1FAEE', boxShadow: '0 1px 3px rgba(29,53,87,0.25)' }}
                      aria-label="Reply to email"
                    >
                      Reply
                    </button>
                    {/* Read — secondary: soft teal fill */}
                    <button
                      onClick={e => { e.stopPropagation(); handleMarkAsRead(email.id) }}
                      className="text-xs font-medium px-3 py-1 rounded-full transition-all hover:shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                      style={{ backgroundColor: '#A8DADC', color: '#1D3557' }}
                      aria-label="Mark as read"
                    >
                      Read
                    </button>
                    {/* Summary — ghost: outlined */}
                    <button
                      onClick={e => { e.stopPropagation(); handleSummary(email) }}
                      className="text-xs font-medium px-3 py-1 rounded-full transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                      style={{ border: '1.5px solid #457B9D', color: '#457B9D', backgroundColor: 'transparent' }}
                      aria-label="View summary"
                    >
                      Summary
                    </button>
                  </div>
                  {/* Line 2: timestamp */}
                  <div className="text-xs font-medium" style={{ color: '#A8DADC' }}>{formatTimestamp(email.timestamp)}</div>
                </div>
              )
            })
          )}
        </div>

        {/* Right Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto py-10 px-4">

            {/* View: empty */}
            {effectiveRightView === 'empty' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-zinc-400">Select an email to read.</p>
              </div>
            )}

            {/* View: summary */}
            {effectiveRightView === 'summary' && summaryEmail && (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <button
                    onClick={() => setRightView(selectedEmailId ? 'email' : 'empty')}
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
                  {summaryLoading && (
                    <p className="text-sm text-zinc-400">Loading summary...</p>
                  )}
                  {!summaryLoading && summaryError && (
                    <div className="space-y-2">
                      <p className="text-sm text-red-400">{summaryError}</p>
                      <p className="text-xs text-zinc-400">Fallback preview: {summaryEmail.preview}</p>
                    </div>
                  )}
                  {!summaryLoading && !summaryError && summaryData && (
                    <div>
                      <p className="text-sm text-zinc-700 leading-relaxed">{summaryData.summary}</p>
                      {summaryData.bullets && summaryData.bullets.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {summaryData.bullets.map((bullet, index) => (
                            <li key={`${bullet}-${index}`} className="text-xs text-zinc-500">
                              - {bullet}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-zinc-300 mt-4">
                        Summary via agent
                        {summaryData.confidence ? ` (${summaryData.confidence})` : ''}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* View: email */}
            {effectiveRightView === 'email' && selectedEmailId && (() => {
              const email = inboxPayload.inbox.find(e => e.id === selectedEmailId)
              if (!email) return null
              return (
                <div>
                  <div className="flex items-center gap-2 mb-6">
                    <button
                      onClick={() => { setSelectedEmailId(null); setRightView('empty') }}
                      className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded"
                    >
                      Back
                    </button>
                    <span className="text-zinc-300">/</span>
                    <span className="text-sm text-zinc-600 font-medium">Email</span>
                  </div>
                  <div className="border-t border-gray-100 pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${categoryBadge(email.category)}`}>
                        {email.category}
                      </span>
                      <span className="text-xs text-zinc-400">{formatTimestamp(email.timestamp)}</span>
                    </div>
                    <h2 className="text-base font-medium text-zinc-800 mb-1">{email.subject}</h2>
                    <p className="text-xs text-zinc-500 mb-4">From: {email.from}</p>
                    {/* Action row */}
                    <div className="flex items-center gap-2 mb-6">
                      {/* Reply — primary */}
                      <button
                        onClick={() => handleReply(email)}
                        className="text-sm font-semibold px-5 py-2 rounded-lg transition-all hover:shadow-md active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: '#1D3557', color: '#F1FAEE', boxShadow: '0 1px 4px rgba(29,53,87,0.25)' }}
                        aria-label="Reply to email"
                      >
                        Reply
                      </button>
                      {/* Read — secondary */}
                      <button
                        onClick={() => handleMarkAsRead(email.id)}
                        className="text-sm font-medium px-5 py-2 rounded-lg transition-all hover:shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: '#A8DADC', color: '#1D3557' }}
                        aria-label="Mark as read"
                      >
                        Read
                      </button>
                      {/* Summary — ghost */}
                      <button
                        onClick={() => handleSummary(email)}
                        className="text-sm font-medium px-5 py-2 rounded-lg transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ border: '1.5px solid #457B9D', color: '#457B9D', backgroundColor: 'transparent' }}
                        aria-label="View summary"
                      >
                        Summary
                      </button>
                    </div>
                    <div className="p-4 bg-white border border-gray-100 rounded-lg">
                      <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">{email.preview || 'No content available.'}</p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* View: draft */}
            {effectiveRightView === 'draft' && (
              <div>
                {/* Header */}
                <div className="mb-6">
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Email Draft Review</p>
                  <h1 className="text-xl font-semibold text-gray-800">{inboxPayload.draft.subject}</h1>
                  <p className="text-sm text-gray-500 mt-1">To: {inboxPayload.draft.to}</p>
                </div>

                {/* Waiting for rewrite indicator */}
                {waitingForRewrite && (
                  <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-sm text-blue-600">Agent is rewriting the draft...</p>
                  </div>
                )}

                {/* Paragraphs */}
                <div className="space-y-5 mb-8">
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

                {/* Intent Suggestions */}
                {intentSuggestions.length > 0 && (
                  <div className="mb-6">
                    <label className="block text-xs text-zinc-500 mb-2">Intent Suggestions</label>
                    <div className="flex flex-wrap gap-2">
                      {intentSuggestions.map(suggestion => {
                        const selected = !!selectedIntents[suggestion.id]
                        return (
                          <button
                            key={suggestion.id}
                            onClick={() => toggleIntent(suggestion.id)}
                            className="text-sm font-medium px-3 py-1.5 rounded-full border transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-1 hover:opacity-85"
                            style={selected
                              ? { backgroundColor: '#457B9D', color: '#F1FAEE', borderColor: '#457B9D' }
                              : { backgroundColor: 'white', color: '#1D3557', borderColor: '#A8DADC' }}
                            aria-pressed={selected}
                          >
                            {suggestion.text}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Footer buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => submit(true)}
                    disabled={submitting || waitingForRewrite}
                    className={`flex-1 text-sm font-semibold py-2.5 rounded-lg transition-opacity ${submitting || waitingForRewrite ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
                    style={{ backgroundColor: '#2A9D8F', color: '#F1FAEE' }}
                  >
                    Confirm & Send
                  </button>
                  <button
                    onClick={() => submit(false)}
                    disabled={submitting || waitingForRewrite}
                    className={`px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${submitting || waitingForRewrite ? 'opacity-50 cursor-not-allowed' : ''}`}
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

        {/* Waiting for rewrite indicator */}
        {waitingForRewrite && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-600">Agent is rewriting the draft...</p>
          </div>
        )}

        {/* Paragraphs */}
        <div className="space-y-5 mb-8">
          {legacyPayload.paragraphs.map(p => {
            const state = states[p.id] || 'normal'
            const action = actions.find(a => a.paragraphId === p.id)

            if (state === 'deleted') return (
              <div key={p.id} className="space-y-1">
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
                    {action?.reason && (
                      <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 px-1.5 py-0.5 rounded">
                        {reasonLabel(action.reason)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => undoParagraph(p.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded px-1"
                  >
                    undo
                  </button>
                </div>
              </div>
            )

            if (state === 'rewriting') return (
              <div key={p.id} className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-gray-500 mb-2 whitespace-pre-wrap">{p.content}</p>
                <input
                  className="w-full text-sm border border-blue-200 rounded px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="How should it be rewritten? (e.g. more direct, no formalities)"
                  value={rewriteInput[p.id] || ''}
                  onChange={e => setRewriteInput(r => ({ ...r, [p.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300">Confirm</button>
                  <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded">Cancel</button>
                </div>
              </div>
            )

            return (
              <div key={p.id} className="space-y-1">
                <div className="p-4 bg-white border border-gray-100 rounded-lg">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{p.content}</p>
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => startRewrite(p.id)}
                    className="text-xs text-zinc-400 hover:text-blue-500 px-2 py-1 rounded hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
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
            disabled={submitting || waitingForRewrite}
            className={`flex-1 bg-green-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-green-700 transition-colors ${submitting || waitingForRewrite ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Confirm & Send
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting || waitingForRewrite}
            className={`px-4 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors ${submitting || waitingForRewrite ? 'opacity-50 cursor-not-allowed' : ''}`}
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
      className="text-xs font-medium px-2 py-1 rounded transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1"
      style={{ color: '#E63946' }}
      aria-label="Delete paragraph"
    >
      Delete
    </button>
  )

  return (
    <div ref={ref} className="relative">
    <div className="absolute z-10 top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-sm p-1.5 min-w-[148px]">
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
    </div>
  )
}
