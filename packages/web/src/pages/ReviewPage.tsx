import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

interface Paragraph {
  id: string
  content: string
}

interface DraftPayload {
  replyTo: string
  to: string
  subject: string
  paragraphs: Paragraph[]
  ccSuggestions?: CcSuggestion[]
  intentSuggestions?: IntentSuggestion[]
  cc?: string[]
  bcc?: string[]
}

interface EmailPayload {
  to: string
  subject: string
  paragraphs: Paragraph[]
}

interface EmailItem {
  id: string
  from: string
  to?: string
  cc?: string[]
  bcc?: string[]
  subject: string
  preview: string
  body?: string
  headers?: Array<{ label: string; value: string }>
  unread?: boolean
  replyState?: 'idle' | 'loading' | 'ready'
  replyUnread?: boolean
  replyDraft?: DraftPayload
  category: 'Primary' | 'Social' | 'Promotions' | 'Updates' | 'Forums' | string
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
  draft: DraftPayload
}

interface ReviewSessionPayload {
  inbox?: EmailItem[]
  draft?: DraftPayload
  [key: string]: unknown
}

interface Action {
  type: 'delete' | 'rewrite'
  shouldLearn?: boolean
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
type PendingAgentAction = 'regenerate' | 'readMore' | 'reply' | null
type PageStatusState = 'opened' | 'active' | 'hidden' | 'submitted'

// Keys must match REASON_LABELS in preference.ts
const REASONS = [
  { key: 'too_formal',  label: 'Too formal' },
  { key: 'too_casual',  label: 'Too casual' },
  { key: 'too_long',    label: 'Too long' },
  { key: 'wrong_tone',  label: 'Wrong tone' },
  { key: 'off_topic',   label: 'Off topic' },
  { key: 'redundant',   label: 'Redundant' },
  { key: 'inaccurate',  label: 'Inaccurate' },
]

const GMAIL_CATEGORIES = ['Primary', 'Social', 'Promotions', 'Updates', 'Forums'] as const

function reasonLabel(key: string): string {
  return REASONS.find(r => r.key === key)?.label ?? key
}

function normalizeCategory(category: string): 'Primary' | 'Social' | 'Promotions' | 'Updates' | 'Forums' | string {
  const value = category.trim()
  if (value === 'Personal') return 'Primary'
  if (value === 'ADS') return 'Promotions'
  if (value === 'Work') return 'Updates'
  return value
}

function categoryBadge(category: string) {
  const normalized = normalizeCategory(category)
  if (normalized === 'Primary') return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-500'
  if (normalized === 'Social') return 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300'
  if (normalized === 'Promotions') return 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-400'
  if (normalized === 'Updates') return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-slate-300'
  if (normalized === 'Forums') return 'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300'
  return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-slate-400'
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

function joinAddresses(values?: string[]): string {
  return values && values.length > 0 ? values.join(', ') : '—'
}

function paragraphsToText(paragraphs: Paragraph[]): string {
  return paragraphs.map(p => p.content).join('\n\n')
}

function textToParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
    .map((content, index) => ({ id: `edited_${index + 1}`, content }))
}

function buildEditedParagraphs(
  paragraphs: Paragraph[],
  states: Record<string, ParagraphState>,
  rewriteInput: Record<string, string>,
): Paragraph[] {
  return paragraphs.flatMap(paragraph => {
    const state = states[paragraph.id] || 'normal'
    if (state === 'deleted') return []
    if (state === 'rewriting') {
      const edited = rewriteInput[paragraph.id]?.trim()
      return edited ? [{ ...paragraph, content: edited }] : [paragraph]
    }
    const edited = rewriteInput[paragraph.id]?.trim()
    if (edited && edited !== paragraph.content) {
      return [{ ...paragraph, content: edited }]
    }
    return [paragraph]
  })
}

function addUniqueAddress(list: string[], value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return list
  return Array.from(new Set([...list, trimmed]))
}

function fallbackIntentSuggestions(email: EmailItem | null): IntentSuggestion[] {
  if (!email) return []
  return [
    { id: `fallback_ack_${email.id}`, text: 'Acknowledge the email' },
    { id: `fallback_brief_${email.id}`, text: 'Keep the reply brief' },
    { id: `fallback_followup_${email.id}`, text: 'Ask one clear follow-up question' },
  ]
}

function mergeInboxEmails(currentInbox: EmailItem[], incomingInbox: EmailItem[]): EmailItem[] {
  const merged = new Map<string, EmailItem>()
  currentInbox.forEach(email => merged.set(email.id, email))
  incomingInbox.forEach(email => {
    const existing = merged.get(email.id)
    merged.set(email.id, existing ? { ...existing, ...email } : email)
  })
  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp)
}

function updateInboxEmail(
  inbox: EmailItem[],
  emailId: string,
  updater: (email: EmailItem) => EmailItem,
): EmailItem[] {
  return inbox.map(email => email.id === emailId ? updater(email) : email)
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<EmailPayload | InboxPayload | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [states, setStates] = useState<Record<string, ParagraphState>>({})
  const [rewriteInput, setRewriteInput] = useState<Record<string, string>>({})
  const [rewriteLearn, setRewriteLearn] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)
  const [waitingForRewrite, setWaitingForRewrite] = useState(false)
  const revisionRef = useRef(0)

  // Format B state
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
  const [rightView, setRightView] = useState<'draft' | 'summary' | 'email' | 'empty'>('empty')
  const [markedAsRead, setMarkedAsRead] = useState<string[]>([])
  const [userIntention, setUserIntention] = useState('')
  const [selectedIntents, setSelectedIntents] = useState<Record<string, boolean>>({})
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [draftTo, setDraftTo] = useState('')
  const [draftSubject, setDraftSubject] = useState('')
  const [draftCc, setDraftCc] = useState<string[]>([])
  const [draftBcc, setDraftBcc] = useState<string[]>([])
  const [newRecipientType, setNewRecipientType] = useState<'cc' | 'bcc'>('cc')
  const [newRecipientValue, setNewRecipientValue] = useState('')
  const [summaryEmail, setSummaryEmail] = useState<EmailItem | null>(null)
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [pendingAgentAction, setPendingAgentAction] = useState<PendingAgentAction>(null)
  const [activeReplyRequestEmailId, setActiveReplyRequestEmailId] = useState<string | null>(null)
  const [replyDraftOpen, setReplyDraftOpen] = useState(false)

  const resetEditState = useCallback(() => {
    setActions([])
    setStates({})
    setRewriteInput({})
    setUserIntention('')
    setSelectedIntents({})
    setDraftTo('')
    setDraftSubject('')
    setDraftCc([])
    setDraftBcc([])
    setSelectedCategories([])
    setNewRecipientType('cc')
    setNewRecipientValue('')
    setSubmitting(false)
  }, [])

  const postPageStatus = useCallback(async (
    state: PageStatusState,
    options?: { stopMonitoring?: boolean; reason?: string },
  ) => {
    try {
      await fetch(`/api/sessions/${id}/page-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          stopMonitoring: options?.stopMonitoring === true,
          reason: options?.reason,
        }),
      })
    } catch {
      // ignore page status failures
    }
  }, [id])

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as EmailPayload | InboxPayload)
        revisionRef.current = data.revision ?? 0
        if (data.status === 'completed') setIsCompleted(true)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  useEffect(() => {
    void postPageStatus('opened')
    const activeTimer = window.setInterval(() => {
      void postPageStatus(document.visibilityState === 'visible' ? 'active' : 'hidden')
    }, 10000)
    const onVisibility = () => { void postPageStatus(document.visibilityState === 'visible' ? 'active' : 'hidden') }
    const onBeforeUnload = () => { void postPageStatus('hidden', { reason: 'page_unload' }) }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.clearInterval(activeTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [postPageStatus])

  // Poll for payload updates while waiting for agent rewrite
  useEffect(() => {
    if (!waitingForRewrite) return
    const interval = setInterval(async () => {
      try {
        const data = await fetch(`/api/sessions/${id}`).then(r => r.json())
        if (data.revision > revisionRef.current) {
          revisionRef.current = data.revision
          setPayload(currentPayload => {
            if (!currentPayload || !('inbox' in currentPayload) || !Array.isArray(currentPayload.inbox)) {
              return data.payload as EmailPayload | InboxPayload
            }
            const nextPayload = data.payload as ReviewSessionPayload
            if (!Array.isArray(nextPayload.inbox)) return data.payload as EmailPayload | InboxPayload
            if (pendingAgentAction === 'readMore' || pendingAgentAction === 'reply') {
              const mergedInbox = mergeInboxEmails(currentPayload.inbox, nextPayload.inbox).map(email => {
                if (
                  pendingAgentAction === 'reply' &&
                  activeReplyRequestEmailId &&
                  email.id === activeReplyRequestEmailId &&
                  selectedEmailId === activeReplyRequestEmailId &&
                  rightView === 'draft' &&
                  email.replyState === 'ready'
                ) {
                  return { ...email, replyUnread: false }
                }
                return email
              })
              return {
                ...nextPayload,
                inbox: mergedInbox,
                draft: nextPayload.draft ?? currentPayload.draft,
              } as InboxPayload
            }
            return {
              ...nextPayload,
              inbox: nextPayload.inbox,
              draft: nextPayload.draft ?? currentPayload.draft,
            } as InboxPayload
          })
          if (pendingAgentAction === 'regenerate') resetEditState()

          // For reply actions, keep waiting until the target email's replyState is "ready"
          if (pendingAgentAction === 'reply' && activeReplyRequestEmailId) {
            const serverPayload = data.payload as ReviewSessionPayload
            const serverInbox = Array.isArray(serverPayload?.inbox) ? serverPayload.inbox : []
            const targetEmail = serverInbox.find((e: EmailItem) => e.id === activeReplyRequestEmailId)
            if (targetEmail && targetEmail.replyState !== 'ready') {
              // Still loading — don't stop waiting
              return
            }
          }

          setWaitingForRewrite(false)
          setPendingAgentAction(null)
          setActiveReplyRequestEmailId(null)
          setRightView('draft')
        }
      } catch { /* ignore polling errors */ }
    }, 1500)
    return () => clearInterval(interval)
  }, [waitingForRewrite, id, pendingAgentAction, activeReplyRequestEmailId, selectedEmailId, rightView, resetEditState])

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

  const startEdit = (pid: string) => {
    const sourceParagraph = hasInbox
      ? activeDraftForState?.paragraphs.find(paragraph => paragraph.id === pid)
      : (payload as EmailPayload | null)?.paragraphs?.find(paragraph => paragraph.id === pid)
    setStates(s => ({ ...s, [pid]: 'rewriting' }))
    setRewriteInput(current => ({
      ...current,
      [pid]: current[pid] ?? sourceParagraph?.content ?? '',
    }))
  }

  const markParagraphForRewrite = (pid: string) => {
    const existing = actions.find(action => action.paragraphId === pid && action.type === 'rewrite')
    if (existing) {
      setActions(current => current.filter(action => !(action.paragraphId === pid && action.type === 'rewrite')))
      return
    }
    setActions(current => [
      ...current.filter(action => action.paragraphId !== pid || action.type !== 'rewrite'),
      { type: 'rewrite', paragraphId: pid, instruction: 'Rewrite this paragraph' },
    ])
  }

  const confirmRewrite = (pid: string) => {
    const editedText = rewriteInput[pid]?.trim()
    if (!editedText) return
    setActions(a => a.map(x =>
      x.paragraphId === pid && x.type === 'rewrite'
        ? { ...x, instruction: editedText, ...(rewriteLearn[pid] ? { shouldLearn: true } : {}) }
        : x
    ))
    setStates(s => ({ ...s, [pid]: 'normal' }))
  }

  const undoParagraph = (pid: string) => {
    setStates(s => ({ ...s, [pid]: 'normal' }))
    setActions(a => a.filter(x => x.paragraphId !== pid))
    setRewriteInput(current => {
      const next = { ...current }
      delete next[pid]
      return next
    })
  }

  const handleViewEmail = (email: EmailItem) => {
    if (email.replyUnread) {
      setPayload(currentPayload => {
        if (!currentPayload || !('inbox' in currentPayload)) return currentPayload
        return {
          ...currentPayload,
          inbox: updateInboxEmail(currentPayload.inbox, email.id, current => ({ ...current, replyUnread: false })),
        }
      })
    }
    setSelectedEmailId(email.id)
    setRightView('email')
  }

  const requestReplyDraft = async (email: EmailItem) => {
    setPayload(currentPayload => {
      if (!currentPayload || !('inbox' in currentPayload)) return currentPayload
      return {
        ...currentPayload,
        inbox: updateInboxEmail(currentPayload.inbox, email.id, current => ({
          ...current,
          replyState: 'loading',
          replyUnread: false,
        })),
      }
    })
    setPendingAgentAction('reply')
    setActiveReplyRequestEmailId(email.id)
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmed: false,
        regenerate: true,
        requestReplyDraft: true,
        emailId: email.id,
        emailSubject: email.subject,
      }),
    }).then(r => r.json())

    if (result.rewriting) {
      setWaitingForRewrite(true)
      return
    }

    setPendingAgentAction(null)
    setActiveReplyRequestEmailId(null)
    setPayload(currentPayload => {
      if (!currentPayload || !('inbox' in currentPayload)) return currentPayload
      return {
        ...currentPayload,
        inbox: updateInboxEmail(currentPayload.inbox, email.id, current => ({ ...current, replyState: 'idle' })),
      }
    })
  }

  const handleReply = (email: EmailItem) => {
    setSelectedEmailId(email.id)
    setRightView('draft')
    if (email.replyUnread) {
      setPayload(currentPayload => {
        if (!currentPayload || !('inbox' in currentPayload)) return currentPayload
        return {
          ...currentPayload,
          inbox: updateInboxEmail(currentPayload.inbox, email.id, current => ({ ...current, replyUnread: false })),
        }
      })
    }
    if (!email.replyDraft && email.replyState !== 'loading') {
      void requestReplyDraft(email)
    }
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

  const requestMoreEmails = async () => {
    if (!hasInbox) return
    setSubmitting(true)
    setPendingAgentAction('readMore')
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmed: false,
        regenerate: true,
        readMore: true,
        requestedCategories: selectedCategories,
        currentlyLoadedEmailIds: (payload as InboxPayload).inbox.map(email => email.id),
        currentlyVisibleEmailCount: (payload as InboxPayload).inbox.filter(email =>
          email.unread !== false &&
          !markedAsRead.includes(email.id) &&
          (selectedCategories.length === 0 || selectedCategories.includes(normalizeCategory(email.category)))
        ).length,
      }),
    }).then(r => r.json())

    if (result.rewriting) {
      setWaitingForRewrite(true)
      setSubmitting(false)
      return
    }

    setPendingAgentAction(null)
    setSubmitting(false)
  }

  const submit = async (confirmed: boolean) => {
    setSubmitting(true)
    const hasInbox = payload && 'inbox' in payload && Array.isArray((payload as InboxPayload).inbox)
    const selectedIntentsList = Object.keys(selectedIntents).map(intentId => ({ id: intentId, accepted: true }))
    const editedDraftParagraphs = hasInbox
      ? buildEditedParagraphs(activeDraftForState?.paragraphs ?? [], states, rewriteInput)
      : []
    if (hasInbox && confirmed && selectedEmailId) {
      const body = {
        actions,
        confirmed: true,
        markedAsRead,
        markedAsReadDetails: (payload as InboxPayload).inbox
          .filter(email => markedAsRead.includes(email.id))
          .map(email => ({ id: email.id, from: email.from, subject: email.subject })),
        userIntention,
        selectedIntents: selectedIntentsList,
        unreadEmailCount: (payload as InboxPayload).inbox.filter(email => email.unread !== false && !markedAsRead.includes(email.id)).length,
        editedDraft: {
          emailId: selectedEmailId,
          to: draftTo,
          cc: draftCc,
          bcc: draftBcc,
          subject: draftSubject,
          body: paragraphsToText(editedDraftParagraphs),
          paragraphs: editedDraftParagraphs,
        },
        pageStatus: {
          state: 'submitted',
        },
      }
      const result = await fetch(`/api/sessions/${id}/email-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: selectedEmailId,
          ...body,
        }),
      }).then(r => r.json())

      if (result.callbackFailed) {
        setCallbackFailed(true)
      }

      setPayload(currentPayload => {
        if (!currentPayload || !('inbox' in currentPayload)) return currentPayload
        return {
          ...currentPayload,
          inbox: currentPayload.inbox.filter(email => email.id !== selectedEmailId),
        }
      })
      setMarkedAsRead(current => Array.from(new Set([...current, selectedEmailId])))
      setSelectedEmailId(null)
      setRightView('empty')
      resetEditState()
      setSubmitting(false)
      return
    }
    const body = hasInbox
      ? JSON.stringify({
          actions,
          confirmed,
          regenerate: !confirmed,
          markedAsRead,
          markedAsReadDetails: (payload as InboxPayload).inbox
            .filter(email => markedAsRead.includes(email.id))
            .map(email => ({ id: email.id, from: email.from, subject: email.subject })),
          userIntention,
          selectedIntents: selectedIntentsList,
          unreadEmailCount: (payload as InboxPayload).inbox.filter(email => email.unread !== false && !markedAsRead.includes(email.id)).length,
          editedDraft: {
            emailId: selectedEmailId ?? undefined,
            to: draftTo,
            cc: draftCc,
            bcc: draftBcc,
            subject: draftSubject,
            body: paragraphsToText(editedDraftParagraphs),
            paragraphs: editedDraftParagraphs,
          },
        })
      : JSON.stringify({ actions, confirmed, regenerate: !confirmed })
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then(r => r.json())

    if (!confirmed && result.rewriting) {
      // Regenerate: wait for agent to update payload
      setPendingAgentAction('regenerate')
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

  const stopMonitoringAndLeave = async () => {
    await postPageStatus('hidden', { stopMonitoring: true, reason: 'user_left_email_review' })
    navigate('/')
  }

  const hasInbox = payload && 'inbox' in payload && Array.isArray((payload as InboxPayload).inbox)
  const inboxPayloadForState = hasInbox ? payload as InboxPayload : null
  const selectedInboxEmail = inboxPayloadForState && selectedEmailId
    ? inboxPayloadForState.inbox.find(email => email.id === selectedEmailId) ?? null
    : null
  const activeDraftForState = inboxPayloadForState
    ? (selectedInboxEmail ? selectedInboxEmail.replyDraft ?? null : inboxPayloadForState.draft)
    : null

  useEffect(() => {
    if (!activeDraftForState) return
    setDraftTo(activeDraftForState.to)
    setDraftSubject(activeDraftForState.subject)
    setDraftCc(activeDraftForState.cc ?? selectedInboxEmail?.cc ?? [])
    setDraftBcc(activeDraftForState.bcc ?? selectedInboxEmail?.bcc ?? [])
  }, [activeDraftForState?.to, activeDraftForState?.subject, activeDraftForState?.paragraphs, activeDraftForState?.cc, activeDraftForState?.bcc, selectedInboxEmail?.cc, selectedInboxEmail?.bcc])

  if (error) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-400 text-sm">Server not reachable — is AgentClick running?</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-gray-400 dark:text-slate-500">Loading draft...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-400">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-700 dark:text-slate-200 font-medium">Done. Your agent is continuing.</p>
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-gray-400 dark:text-slate-500 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  // Format B — two-column layout
  if (hasInbox) {
    const inboxPayload = payload as InboxPayload
    const unreadEmails = inboxPayload.inbox.filter(e => e.unread !== false && !markedAsRead.includes(e.id))
    const filteredEmails = unreadEmails.filter(email =>
      selectedCategories.length === 0 || selectedCategories.includes(normalizeCategory(email.category))
    )
    const visibleEmails = filteredEmails.slice(0, 20)
    const selectedEmail = selectedInboxEmail
    const activeDraft = selectedEmail?.replyDraft ?? null
    const replyIsLoading = selectedEmail?.replyState === 'loading'
    const replyIsReady = selectedEmail?.replyState === 'ready' || !!selectedEmail?.replyDraft
    const intentSuggestions = activeDraft && activeDraft.intentSuggestions && activeDraft.intentSuggestions.length > 0
      ? activeDraft.intentSuggestions
      : fallbackIntentSuggestions(selectedEmail)
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
        const rewriteRequested = action?.type === 'rewrite'
        const editedValue = rewriteInput[p.id]
        const hasEditedValue = typeof editedValue === 'string' && editedValue.trim().length > 0 && editedValue !== p.content

        if (state === 'deleted') return (
          <div key={p.id} className="space-y-1">
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950 border border-red-100 dark:border-red-900 rounded-lg">
              <div className="flex-1 min-w-0">
                <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
                {action?.reason && (
                  <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 dark:bg-red-900 px-1.5 py-0.5 rounded">
                    {reasonLabel(action.reason)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => undoParagraph(p.id)}
                className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded px-1"
              >
                undo
              </button>
            </div>
          </div>
        )

        if (state === 'rewriting') return (
          <div key={p.id} className="space-y-1">
            <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <textarea
                className="w-full text-sm border border-blue-200 dark:border-blue-700 rounded px-3 py-2 mb-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                rows={Math.max(3, Math.ceil((rewriteInput[p.id] || p.content).length / 90))}
                value={rewriteInput[p.id] || ''}
                onChange={e => setRewriteInput(r => ({ ...r, [p.id]: e.target.value }))}
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-slate-500 cursor-pointer select-none">
                  <input type="checkbox" checked={!!rewriteLearn[p.id]} onChange={e => setRewriteLearn(r => ({ ...r, [p.id]: e.target.checked }))} className="rounded" />
                  Remember this style
                </label>
                <div className="flex gap-2">
                  <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300">Apply</button>
                  <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )

        return (
          <div key={p.id} className="space-y-1">
            <div className={`p-4 border rounded-lg ${hasEditedValue ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800'}`}>
              <p className={`text-sm leading-relaxed whitespace-pre-wrap ${hasEditedValue ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-slate-300'}`}>
                {hasEditedValue ? editedValue : p.content}
              </p>
              {rewriteRequested && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Marked for agent rewrite on regenerate.</p>
              )}
            </div>
            <div className="flex justify-end gap-1">
              <button
                onClick={() => markParagraphForRewrite(p.id)}
                style={{ color: 'var(--c-blue)' }}
                className="text-xs font-medium px-2 py-1 rounded transition-opacity hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-1"
              >
                {rewriteRequested ? 'Unmark Rewrite' : 'Rewrite'}
              </button>
              <button
                onClick={() => startEdit(p.id)}
                className="text-xs font-medium px-2 py-1 rounded transition-opacity hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-offset-1 text-zinc-500 dark:text-slate-400"
              >
                Edit
              </button>
              <DeleteButton onConfirm={(reasonKey) => deleteParagraph(p.id, reasonKey)} />
            </div>
          </div>
        )
      })

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col">
        {isCompleted && (
          <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">This session has been completed.</p>
            <button onClick={() => navigate('/')} className="text-sm text-blue-400 hover:text-blue-500 transition-colors">← Back</button>
          </div>
        )}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* Left Panel — Inbox List */}
        <div className="w-full md:w-72 md:shrink-0 bg-white dark:bg-zinc-900 border-b md:border-b-0 md:border-r border-gray-100 dark:border-zinc-800 overflow-y-auto max-h-[30vh] md:max-h-full">
          {!isCompleted && (
            <div className="p-4 border-b border-gray-50 dark:border-zinc-800 space-y-2">
              <button onClick={stopMonitoringAndLeave} className="text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors block w-full text-left">← Back</button>
              <button
                onClick={stopMonitoringAndLeave}
                className="w-full text-xs font-medium px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                Stop Agent Monitor
              </button>
            </div>
          )}
          <div className="p-4 border-b border-gray-50 dark:border-zinc-800 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-slate-500">Unread Inbox</p>
              <p className="text-sm text-zinc-700 dark:text-slate-300 mt-1">
                {unreadEmails.length} unread email{unreadEmails.length === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setFilterOpen(current => !current)}
                className="w-full flex items-center justify-between text-left"
              >
                <p className="text-[11px] uppercase tracking-wider text-zinc-400 dark:text-slate-500">Filter Categories</p>
                <span className="text-[11px] text-zinc-400 dark:text-slate-500">{filterOpen ? 'Hide' : 'Show'}</span>
              </button>
              {filterOpen && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {GMAIL_CATEGORIES.map(category => {
                    const selected = selectedCategories.includes(category)
                    return (
                      <button
                        key={category}
                        onClick={() => setSelectedCategories(current => selected ? current.filter(value => value !== category) : [...current, category])}
                        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                          selected
                            ? `${categoryBadge(category)} border-transparent`
                            : 'border-gray-200 dark:border-zinc-700 text-zinc-500 dark:text-slate-400 bg-white dark:bg-zinc-950'
                        }`}
                      >
                        {category}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {visibleEmails.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-slate-500 p-4">No unread emails.</p>
          ) : (
            <>
              {visibleEmails.map(email => {
                const isSelected = selectedEmailId === email.id
                const replyLoading = email.replyState === 'loading'
                const replyReady = email.replyState === 'ready' || !!email.replyDraft
                return (
                  <div
                    key={email.id}
                    className={`p-4 cursor-pointer border-b border-gray-50 dark:border-zinc-800 transition-colors ${
                      isSelected
                        ? 'border-l-2'
                        : 'hover:bg-gray-50 dark:hover:bg-zinc-800'
                    }`}
                    style={isSelected ? { backgroundColor: 'var(--c-file-highlight)', borderLeftColor: 'var(--c-blue)' } : {}}
                    onClick={() => handleViewEmail(email)}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${categoryBadge(email.category)}`}>
                        {normalizeCategory(email.category)}
                      </span>
                      <span className="text-sm font-medium text-zinc-800 dark:text-slate-200 truncate flex-1 min-w-0">{email.from}</span>
                      {replyReady && (
                        <span
                          className="inline-flex h-3 w-3 shrink-0 rounded-full border-2 border-blue-500"
                          title="Reply draft ready"
                        />
                      )}
                      {email.replyUnread && (
                        <span
                          className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-red-500"
                          title="Unread reply draft update"
                        />
                      )}
                      {replyLoading && (
                        <span
                          className="inline-flex h-3 w-3 shrink-0 rounded-full border-2 border-amber-500 border-t-transparent animate-spin"
                          title="Reply draft loading"
                        />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-slate-400 truncate mb-0.5">{email.subject}</p>
                    <p className="text-xs text-zinc-400 dark:text-slate-500 line-clamp-2 mb-2">{email.preview}</p>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <button
                        onClick={e => { e.stopPropagation(); handleReply(email) }}
                        disabled={waitingForRewrite && pendingAgentAction === 'reply' && activeReplyRequestEmailId !== email.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all hover:shadow-md active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: 'var(--c-navy)', color: 'var(--c-bg)', boxShadow: '0 1px 3px rgba(29,53,87,0.25)' }}
                        aria-label="Reply to email"
                      >
                        {replyLoading ? 'Loading...' : 'Reply'}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleMarkAsRead(email.id) }}
                        className="text-xs font-medium px-3 py-1.5 rounded-full transition-all hover:shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: 'var(--c-accent)', color: 'var(--c-text)' }}
                        aria-label="Mark as read"
                      >
                        Read
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleSummary(email) }}
                        className="text-xs font-medium px-3 py-1.5 rounded-full transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ border: '1.5px solid var(--c-blue)', color: 'var(--c-blue)', backgroundColor: 'transparent' }}
                        aria-label="View summary"
                      >
                        Summary
                      </button>
                    </div>
                    <div className="text-xs font-medium" style={{ color: 'var(--c-accent)' }}>{formatTimestamp(email.timestamp)}</div>
                  </div>
                )
              })}
              <div className="p-4 border-t border-gray-50 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={requestMoreEmails}
                  disabled={submitting || waitingForRewrite}
                  className={`w-full text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                    submitting || waitingForRewrite
                      ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-zinc-700 text-zinc-400 dark:text-slate-500'
                      : 'border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950'
                  }`}
                >
                  Read More
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto py-10 px-4">

            {/* View: empty */}
            {effectiveRightView === 'empty' && (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-zinc-400 dark:text-slate-500">Select an email to read.</p>
              </div>
            )}

            {/* View: summary */}
            {effectiveRightView === 'summary' && summaryEmail && (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <button
                    onClick={() => setRightView(selectedEmailId ? 'email' : 'empty')}
                    className="text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors"
                  >
                    Back
                  </button>
                  <span className="text-zinc-300 dark:text-slate-600">/</span>
                  <span className="text-sm text-zinc-600 dark:text-slate-300 font-medium">Summary</span>
                </div>
                <div className="border-t border-gray-100 dark:border-zinc-800 pt-6">
                  <h2 className="text-base font-medium text-zinc-800 dark:text-slate-200 mb-1">{summaryEmail.subject}</h2>
                  <p className="text-xs text-zinc-500 dark:text-slate-400 mb-4">From: {summaryEmail.from}</p>
                  {summaryLoading && (
                    <p className="text-sm text-zinc-400 dark:text-slate-500">Loading summary...</p>
                  )}
                  {!summaryLoading && summaryError && (
                    <div className="space-y-2">
                      <p className="text-sm text-red-400">{summaryError}</p>
                      <p className="text-xs text-zinc-400 dark:text-slate-500">Fallback preview: {summaryEmail.preview}</p>
                    </div>
                  )}
                  {!summaryLoading && !summaryError && summaryData && (
                    <div>
                      <p className="text-sm text-zinc-700 dark:text-slate-300 leading-relaxed">{summaryData.summary}</p>
                      {summaryData.bullets && summaryData.bullets.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {summaryData.bullets.map((bullet, index) => (
                            <li key={`${bullet}-${index}`} className="text-xs text-zinc-500 dark:text-slate-400">
                              - {bullet}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-zinc-300 dark:text-slate-600 mt-4">
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
                      className="text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded"
                    >
                      Back
                    </button>
                    <span className="text-zinc-300 dark:text-slate-600">/</span>
                    <span className="text-sm text-zinc-600 dark:text-slate-300 font-medium">Email</span>
                  </div>
                  <div className="border-t border-gray-100 dark:border-zinc-800 pt-6">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${categoryBadge(email.category)}`}>
                        {normalizeCategory(email.category)}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-slate-500">{formatTimestamp(email.timestamp)}</span>
                    </div>
                    <h2 className="text-base font-medium text-zinc-800 dark:text-slate-200 mb-1">{email.subject}</h2>
                    <div className="mb-4 space-y-1">
                      <p className="text-xs text-zinc-500 dark:text-slate-400">From: {email.from}</p>
                      <p className="text-xs text-zinc-500 dark:text-slate-400">To: {email.to ?? inboxPayload.draft.replyTo ?? '—'}</p>
                      {email.cc && email.cc.length > 0 && (
                        <p className="text-xs text-zinc-500 dark:text-slate-400">Cc: {joinAddresses(email.cc)}</p>
                      )}
                      {email.bcc && email.bcc.length > 0 && (
                        <p className="text-xs text-zinc-500 dark:text-slate-400">Bcc: {joinAddresses(email.bcc)}</p>
                      )}
                    </div>
                    {/* Action row */}
                    <div className="flex items-center gap-2 mb-6">
                      {/* Reply — primary */}
                      <button
                        onClick={() => handleReply(email)}
                        disabled={waitingForRewrite && pendingAgentAction === 'reply' && activeReplyRequestEmailId !== email.id}
                        className="text-sm font-semibold px-5 py-2 rounded-lg transition-all hover:shadow-md active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: 'var(--c-navy)', color: 'var(--c-bg)', boxShadow: '0 1px 4px rgba(29,53,87,0.25)' }}
                        aria-label="Reply to email"
                      >
                        Reply
                      </button>
                      {/* Read — secondary */}
                      <button
                        onClick={() => handleMarkAsRead(email.id)}
                        className="text-sm font-medium px-5 py-2 rounded-lg transition-all hover:shadow-sm active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ backgroundColor: 'var(--c-accent)', color: 'var(--c-text)' }}
                        aria-label="Mark as read"
                      >
                        Read
                      </button>
                      {/* Summary — ghost */}
                      <button
                        onClick={() => handleSummary(email)}
                        className="text-sm font-medium px-5 py-2 rounded-lg transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1"
                        style={{ border: '1.5px solid var(--c-blue)', color: 'var(--c-blue)', backgroundColor: 'transparent' }}
                        aria-label="View summary"
                      >
                        Summary
                      </button>
                    </div>
                    <div className="p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg">
                      <p className="text-xs uppercase tracking-wider text-zinc-400 dark:text-slate-500 mb-2">Full Email</p>
                      {(() => {
                        const bodyContent = email.body || email.preview || ''
                        const hasHtml = /<(html|body|div|table)\b/i.test(bodyContent)
                        if (!bodyContent) {
                          return <p className="text-sm text-zinc-700 dark:text-slate-300 leading-relaxed">No content available.</p>
                        }
                        if (hasHtml) {
                          return (
                            <iframe
                              sandbox="allow-same-origin"
                              srcDoc={bodyContent}
                              referrerPolicy="no-referrer"
                              style={{ width: '100%', border: 'none', overflow: 'hidden', minHeight: '120px' }}
                              onLoad={(e) => {
                                const iframe = e.currentTarget
                                try {
                                  const h = iframe.contentDocument?.body?.scrollHeight
                                  if (h) {
                                    iframe.style.height = h + 16 + 'px'
                                  }
                                } catch { /* cross-origin guard */ }
                              }}
                            />
                          )
                        }
                        // Convert plain text with parenthesized URLs into React elements with clickable links
                        // Pattern: "LINK TEXT ( https://... )" → <a href="...">LINK TEXT</a>
                        // Also handles standalone "( https://... )" and bare URLs on their own line
                        const parts: React.ReactNode[] = []
                        const urlPattern = /(\S[^(]*?)\s*\( *(https?:\/\/\S+?) *\)|\( *(https?:\/\/\S+?) *\)|^(https?:\/\/\S+)$/gm
                        let lastIndex = 0
                        let match: RegExpExecArray | null
                        while ((match = urlPattern.exec(bodyContent)) !== null) {
                          if (match.index > lastIndex) {
                            parts.push(bodyContent.slice(lastIndex, match.index))
                          }
                          if (match[1] && match[2]) {
                            // "LINK TEXT ( url )" → clickable link
                            parts.push(
                              <a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">
                                {match[1].trim()}
                              </a>
                            )
                          } else {
                            // Standalone "( url )" or bare URL → clickable "[link]"
                            const url = match[3] || match[4]
                            parts.push(
                              <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">
                                [link]
                              </a>
                            )
                          }
                          lastIndex = match.index + match[0].length
                        }
                        if (lastIndex < bodyContent.length) {
                          parts.push(bodyContent.slice(lastIndex))
                        }
                        return (
                          <p className="text-sm text-zinc-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                            {parts}
                          </p>
                        )
                      })()}
                      {email.headers && email.headers.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-1">
                          {email.headers.map(header => (
                            <p key={`${header.label}:${header.value}`} className="text-xs text-zinc-500 dark:text-slate-400">
                              <span className="font-medium text-zinc-600 dark:text-slate-300">{header.label}:</span> {header.value}
                            </p>
                          ))}
                        </div>
                      )}
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
                  <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">Email Draft Review</p>
                  <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">{draftSubject || activeDraft?.subject || `Re: ${selectedEmail?.subject ?? ''}`}</h1>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">To: {draftTo || activeDraft?.to || selectedEmail?.from || '—'}</p>
                </div>

                {replyIsLoading && !activeDraft && (
                  <div className="mb-6 p-5 bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 rounded-lg flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Generating reply draft</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400">You can keep checking other emails while the agent prepares this draft.</p>
                    </div>
                  </div>
                )}

                {!replyIsLoading && !activeDraft && (
                  <div className="mb-6 p-5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg">
                    <p className="text-sm text-zinc-700 dark:text-slate-300">Reply draft will appear here after you click `Reply` for an email.</p>
                  </div>
                )}

                {activeDraft && (
                  <>
                    <div className="mb-6 p-4 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Reply Draft</p>
                        <div className="flex items-center gap-3">
                          {replyIsReady && (
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-300">Draft ready</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setReplyDraftOpen(current => !current)}
                            className="text-xs text-zinc-500 dark:text-slate-400 hover:text-zinc-700 dark:hover:text-slate-200"
                          >
                            {replyDraftOpen ? 'Fold' : 'Unfold'}
                          </button>
                        </div>
                      </div>
                      {replyDraftOpen && (
                        <div className="space-y-3 mt-3">
                          <div>
                            <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Reply To</label>
                            <div className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-slate-400">
                              {activeDraft.replyTo}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">To</label>
                            <div className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-slate-400">
                              {draftTo}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Subject</label>
                            <input
                              type="text"
                              value={draftSubject}
                              onChange={e => setDraftSubject(e.target.value)}
                              className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Add Recipient</label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setNewRecipientType(type => type === 'cc' ? 'bcc' : 'cc')}
                                className="px-3 py-2 text-sm rounded border border-gray-200 dark:border-zinc-700 text-zinc-600 dark:text-slate-300"
                                title="Toggle recipient type"
                              >
                                {newRecipientType.toUpperCase()} +
                              </button>
                              <input
                                type="text"
                                value={newRecipientValue}
                                onChange={e => setNewRecipientValue(e.target.value)}
                                placeholder={newRecipientType === 'cc' ? 'Add Cc address' : 'Add Bcc address'}
                                className="flex-1 text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (newRecipientType === 'cc') setDraftCc(current => addUniqueAddress(current, newRecipientValue))
                                  else setDraftBcc(current => addUniqueAddress(current, newRecipientValue))
                                  setNewRecipientValue('')
                                }}
                                className="px-3 py-2 text-sm rounded border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300"
                                title="Add recipient"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          {draftCc.length > 0 && (
                            <div>
                              <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Cc</label>
                              <div className="flex flex-wrap gap-2">
                                {draftCc.map(email => (
                                  <button
                                    key={`cc-${email}`}
                                    type="button"
                                    onClick={() => setDraftCc(current => current.filter(value => value !== email))}
                                    className="text-xs px-2 py-1 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300"
                                  >
                                    {email} ×
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {draftBcc.length > 0 && (
                            <div>
                              <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">Bcc</label>
                              <div className="flex flex-wrap gap-2">
                                {draftBcc.map(email => (
                                  <button
                                    key={`bcc-${email}`}
                                    type="button"
                                    onClick={() => setDraftBcc(current => current.filter(value => value !== email))}
                                    className="text-xs px-2 py-1 rounded-full border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300"
                                  >
                                    {email} ×
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-5 mb-8">
                      {renderParagraphs(activeDraft.paragraphs)}
                    </div>
                  </>
                )}

                {/* Waiting for rewrite indicator */}
                {waitingForRewrite && pendingAgentAction !== 'reply' && (
                  <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 rounded-lg flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-sm text-blue-600 dark:text-blue-400">
                      {pendingAgentAction === 'readMore' ? 'Agent is loading more emails...' : 'Agent is rewriting the draft...'}
                    </p>
                  </div>
                )}

                        {!isCompleted && (
                  <>
                    {/* User Intention */}
                    <div className="mb-3">
                      <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-1">What do you want to do? (optional)</label>
                      <input
                        type="text"
                        className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        placeholder="e.g. CC Hanwen, agree to the delay, keep it brief"
                        value={userIntention}
                        onChange={e => setUserIntention(e.target.value)}
                      />
                    </div>

                    {/* Intent Suggestions */}
                    {activeDraft && intentSuggestions.length > 0 && (
                      <div className="mb-6">
                        <label className="block text-xs text-zinc-500 dark:text-slate-400 mb-2">Reply Suggestions</label>
                        <div className="flex flex-wrap gap-2">
                          {intentSuggestions.map(suggestion => {
                            const selected = !!selectedIntents[suggestion.id]
                            return (
                              <button
                                key={suggestion.id}
                                onClick={() => toggleIntent(suggestion.id)}
                                className="text-sm font-medium px-3 py-1.5 rounded-full border transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-1 hover:opacity-85"
                                style={selected
                                  ? { backgroundColor: 'var(--c-blue)', color: 'var(--c-bg)', borderColor: 'var(--c-blue)' }
                                  : { backgroundColor: 'var(--c-surface)', color: 'var(--c-navy)', borderColor: 'var(--c-accent)' }}
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
                        disabled={submitting || waitingForRewrite || !activeDraft}
                        className={`flex-1 text-sm font-semibold py-2.5 rounded-lg transition-opacity ${submitting || waitingForRewrite || !activeDraft ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
                        style={{ backgroundColor: 'var(--c-teal)', color: 'var(--c-bg)' }}
                      >
                        Confirm & Send
                      </button>
                      <button
                        onClick={() => submit(false)}
                        disabled={submitting || waitingForRewrite || !activeDraft}
                        className={`px-4 text-sm text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors ${submitting || waitingForRewrite || !activeDraft ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        Regenerate
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </div>
        </div>
      </div>
    )
  }

  // Format A — legacy single-column layout (unchanged)
  const legacyPayload = payload as EmailPayload
  const hasActions = actions.length > 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {isCompleted && (
          <div className="mb-6 px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center justify-between">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">This session has been completed.</p>
            <button onClick={() => navigate('/')} className="text-sm text-blue-400 hover:text-blue-500 transition-colors">← Back</button>
          </div>
        )}

        {!isCompleted && (
          <button onClick={() => navigate('/')} className="text-sm text-zinc-400 dark:text-slate-500 hover:text-zinc-600 dark:hover:text-slate-300 transition-colors mb-6 block">← Back</button>
        )}

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">Email Draft Review</p>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-slate-100">{legacyPayload.subject}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">To: {legacyPayload.to}</p>
        </div>

        {/* Waiting for rewrite indicator */}
        {waitingForRewrite && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900 rounded-lg flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-600 dark:text-blue-400">Agent is rewriting the draft...</p>
          </div>
        )}

        {/* Paragraphs */}
        <div className="space-y-5 mb-8">
          {legacyPayload.paragraphs.map(p => {
            const state = states[p.id] || 'normal'
            const action = actions.find(a => a.paragraphId === p.id)
            const rewriteRequested = action?.type === 'rewrite'
            const editedValue = rewriteInput[p.id]
            const hasEditedValue = typeof editedValue === 'string' && editedValue.trim().length > 0 && editedValue !== p.content

            if (state === 'deleted') return (
              <div key={p.id} className="space-y-1">
                <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950 border border-red-100 dark:border-red-900 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-red-400 line-through leading-relaxed">{p.content}</span>
                    {action?.reason && (
                      <span className="ml-2 inline-block text-xs text-red-300 bg-red-100 dark:bg-red-900 px-1.5 py-0.5 rounded">
                        {reasonLabel(action.reason)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => undoParagraph(p.id)}
                    className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded px-1"
                  >
                    undo
                  </button>
                </div>
              </div>
            )

            if (state === 'rewriting') return (
              <div key={p.id} className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <textarea
                  className="w-full text-sm border border-blue-200 dark:border-blue-700 rounded px-3 py-2 mb-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  rows={Math.max(3, Math.ceil((rewriteInput[p.id] || p.content).length / 90))}
                  value={rewriteInput[p.id] || ''}
                  onChange={e => setRewriteInput(r => ({ ...r, [p.id]: e.target.value }))}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-slate-500 cursor-pointer select-none">
                    <input type="checkbox" checked={!!rewriteLearn[p.id]} onChange={e => setRewriteLearn(r => ({ ...r, [p.id]: e.target.checked }))} className="rounded" />
                    Remember this style
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => confirmRewrite(p.id)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300">Apply</button>
                    <button onClick={() => undoParagraph(p.id)} className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 rounded">Cancel</button>
                  </div>
                </div>
              </div>
            )

            return (
              <div key={p.id} className="space-y-1">
                <div className={`p-4 border rounded-lg ${hasEditedValue ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800'}`}>
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap ${hasEditedValue ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-slate-300'}`}>
                    {hasEditedValue ? editedValue : p.content}
                  </p>
                  {rewriteRequested && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">Marked for agent rewrite on regenerate.</p>
                  )}
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => markParagraphForRewrite(p.id)}
                    className="text-xs text-zinc-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
                  >
                    {rewriteRequested ? 'Unmark Rewrite' : 'Rewrite'}
                  </button>
                  <button
                    onClick={() => startEdit(p.id)}
                    className="text-xs text-zinc-500 dark:text-slate-400 hover:text-zinc-700 dark:hover:text-slate-200 px-2 py-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300"
                  >
                    Edit
                  </button>
                  <DeleteButton onConfirm={(reasonKey) => deleteParagraph(p.id, reasonKey)} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Actions summary */}
        {hasActions && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-100 dark:border-amber-900 rounded-lg text-sm text-amber-700 dark:text-amber-400">
            {actions.length} change{actions.length > 1 ? 's' : ''} marked
          </div>
        )}

        {!isCompleted && (
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
              className={`px-4 text-sm text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors ${submitting || waitingForRewrite ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Regenerate
            </button>
          </div>
        )}
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
      style={{ color: 'var(--c-red)' }}
      aria-label="Delete paragraph"
    >
      Delete
    </button>
  )

  return (
    <div ref={ref} className="relative">
    <div className="absolute z-10 top-full right-0 mt-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-sm p-1.5 min-w-[148px]">
      <p className="text-xs text-gray-400 dark:text-slate-500 mb-1 px-2 pt-0.5">Why remove this?</p>
      {REASONS.map(r => (
        <button
          key={r.key}
          onClick={() => { onConfirm(r.key); setOpen(false) }}
          className="block w-full text-left text-xs px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded text-gray-600 dark:text-slate-300 transition-colors"
        >
          {r.label}
        </button>
      ))}
      <div className="border-t border-gray-100 dark:border-zinc-800 mt-1 pt-1">
        <button
          onClick={() => setOpen(false)}
          className="block w-full text-left text-xs px-2 py-1.5 text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
    </div>
  )
}
