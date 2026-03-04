import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import open from 'open'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { learnFromDeletions, learnFromTrajectoryRevisions, getLearnedPreferences, clearPreferences, deletePreference } from './preference.js'
import { createSession, getSession, listSessions, completeSession, setSessionRewriting, updateSessionPayload } from './store.js'

const app = express()
const DEFAULT_PORT = 38173
const PORT = Number(process.env.AGENTCLICK_PORT || process.env.PORT || DEFAULT_PORT)
const OPENCLAW_WEBHOOK = process.env.OPENCLAW_WEBHOOK || 'http://localhost:18789/hooks/agent'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WEB_DIST_DIR = join(__dirname, '../../web/dist')
const SHOULD_SERVE_BUILT_WEB = existsSync(WEB_DIST_DIR) && (__filename.endsWith('/dist/index.js') || process.env.NODE_ENV === 'production')
const WEB_ORIGIN = process.env.WEB_ORIGIN || (SHOULD_SERVE_BUILT_WEB ? `http://localhost:${PORT}` : 'http://localhost:5173')

app.use(cors())
app.use(express.json())

function parsePortFromOrigin(origin: string): number | null {
  try {
    const url = new URL(origin)
    if (url.port) return Number(url.port)
    return url.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Lightweight identity endpoint so clients can verify the service is AgentClick.
app.get('/api/identity', (_req, res) => {
  res.json({
    service: 'agentclick',
    ok: true,
    serverPort: PORT,
    webOrigin: WEB_ORIGIN,
    mode: SHOULD_SERVE_BUILT_WEB ? 'embedded-web' : 'dev-web',
  })
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agentclick', serverPort: PORT })
})

app.get('/api/ports-status', async (_req, res) => {
  const now = Date.now()
  const webPort = parsePortFromOrigin(WEB_ORIGIN)
  let webReachable = false
  let webStatus = 0
  let webError = ''

  try {
    const webResponse = await fetchWithTimeout(`${WEB_ORIGIN}/`, 1500)
    webStatus = webResponse.status
    webReachable = webResponse.ok
  } catch (err) {
    webError = err instanceof Error ? err.message : String(err)
  }

  res.json({
    checkedAt: now,
    server: {
      port: PORT,
      reachable: true,
      isAgentClick: true,
      mode: SHOULD_SERVE_BUILT_WEB ? 'embedded-web' : 'dev-web',
      identityEndpoint: `/api/identity`,
    },
    web: {
      origin: WEB_ORIGIN,
      port: webPort,
      reachable: webReachable,
      status: webStatus,
      error: webError || undefined,
    },
  })
})

// OpenClaw calls this when a review is needed
app.post('/api/review', async (req, res) => {
  const { type, sessionKey, payload, noOpen } = req.body

  if (!sessionKey) {
    console.warn('[agentclick] Warning: sessionKey missing — callback will be skipped')
  }

  const now = Date.now()
  const id = `session_${now}`
  createSession({
    id,
    type: type || 'email_review',
    payload,
    sessionKey,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    revision: 0,
  })

  const routeMap: Record<string, string> = {
    action_approval: 'approval',
    code_review: 'code-review',
    form_review: 'form-review',
    selection_review: 'selection',
    trajectory_review: 'trajectory',
    plan_review: 'plan',
  }
  const path = routeMap[type] ?? 'review'
  const url = `${WEB_ORIGIN}/${path}/${id}`
  if (noOpen) {
    console.log(`[agentclick] Review session created (silent): ${id}`)
  } else {
    console.log(`[agentclick] Review session created: ${id}`)
    console.log(`[agentclick] Opening browser: ${url}`)
    try {
      await open(url)
    } catch (err) {
      console.warn('[agentclick] Failed to open browser:', err)
    }
  }

  res.json({ sessionId: id, url })
})

// Batch create sessions silently (no browser open)
app.post('/api/review/batch', (req, res) => {
  const items = req.body.sessions
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'sessions must be a non-empty array' })
  }

  const routeMap: Record<string, string> = {
    action_approval: 'approval',
    code_review: 'code-review',
    form_review: 'form-review',
    selection_review: 'selection',
    trajectory_review: 'trajectory',
  }

  const results = items.map((item: { type?: string; sessionKey?: string; payload?: unknown }) => {
    const { type, sessionKey, payload } = item
    if (!sessionKey) {
      console.warn('[agentclick] Warning: sessionKey missing in batch item — callback will be skipped')
    }
    const now = Date.now()
    const id = `session_${now}_${Math.random().toString(36).slice(2, 7)}`
    createSession({
      id,
      type: type || 'email_review',
      payload,
      sessionKey,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      revision: 0,
    })
    const path = routeMap[type ?? ''] ?? 'review'
    const url = `${WEB_ORIGIN}/${path}/${id}`
    console.log(`[agentclick] Review session created (silent): ${id}`)
    return { sessionId: id, url }
  })

  res.json({ sessions: results })
})

// List recent sessions for homepage
app.get('/api/sessions', (_req, res) => {
  const list = listSessions(20).map(s => {
    const p = s.payload as Record<string, unknown> | undefined
    // Format B (inbox+draft) stores subject/to inside draft
    const draft = p?.draft as Record<string, unknown> | undefined
    return {
      id: s.id,
      type: s.type,
      status: s.status,
      createdAt: s.createdAt,
      subject: (draft?.subject ?? p?.subject) as string | undefined,
      to: (draft?.to ?? p?.to) as string | undefined,
      risk: p?.risk as string | undefined,
      command: p?.command as string | undefined,
      title: p?.title as string | undefined,
    }
  })
  res.json(list)
})

// Learned preferences from MEMORY.md
app.get('/api/preferences', (_req, res) => {
  res.json({ preferences: getLearnedPreferences() })
})

app.delete('/api/preferences', (_req, res) => {
  clearPreferences()
  console.log('[agentclick] Cleared all learned preferences from MEMORY.md')
  res.json({ ok: true })
})

app.delete('/api/preferences/:index', (req, res) => {
  const index = parseInt(req.params.index, 10)
  if (isNaN(index)) return res.status(400).json({ error: 'Invalid index' })
  deletePreference(index)
  console.log(`[agentclick] Deleted preference at index ${index}`)
  res.json({ ok: true })
})

// Web UI fetches session data
app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

// Mock summary endpoint for inbox items (UI integration first)
app.get('/api/sessions/:id/summary', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const payload = session.payload as Record<string, unknown> | undefined
  const inbox = (payload?.inbox as Array<Record<string, unknown>> | undefined) ?? []
  const emailId = req.query.emailId as string | undefined
  const email = inbox.find(item => item.id === emailId)

  if (!email) {
    return res.status(404).json({ error: 'Email not found in session' })
  }

  const preview = String(email.preview ?? '')
  const summaryText = preview.length > 0
    ? `This email appears to be about: ${preview}`
    : 'No preview text is available for this email yet.'

  const from = String(email.from ?? 'Unknown sender')
  const category = String(email.category ?? 'Unknown')

  res.json({
    emailId,
    summary: summaryText,
    bullets: [
      `From: ${from}`,
      `Category: ${category}`,
      'Source: mock summary endpoint (replace with agent summary later)',
    ],
    confidence: 'mock',
  })
})

// Long-poll: agent calls this and blocks until user completes review (up to 5 min)
app.get('/api/sessions/:id/wait', async (req, res) => {
  const TIMEOUT_MS = 5 * 60 * 1000
  const POLL_MS = 1500
  const start = Date.now()

  while (Date.now() - start < TIMEOUT_MS) {
    const session = getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    if (session.status === 'completed' || session.status === 'rewriting') {
      console.log(`[agentclick] /wait returning ${session.status} for ${session.id} (revision=${session.revision})`)
      return res.json(session)
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }

  res.status(408).json({ error: 'timeout', message: 'User did not complete review within 5 minutes' })
})

// Agent updates session payload after rewriting
app.put('/api/sessions/:id/payload', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'rewriting') return res.status(400).json({ error: 'Session is not in rewriting state' })

  console.log(`[agentclick] Payload update requested for ${session.id} (status=${session.status}, revision=${session.revision})`)
  updateSessionPayload(req.params.id, req.body.payload)
  const updated = getSession(req.params.id)
  const newRevision = updated?.revision ?? session.revision + 1
  console.log(`[agentclick] Session ${session.id} payload updated, back to pending (revision=${newRevision})`)

  // Notify main agent that sub-agent completed a rewrite round (fire-and-forget)
  if (session.sessionKey) {
    const priorResult = session.result as Record<string, unknown> | undefined
    const actions = (priorResult?.actions ?? []) as Array<{ type: string; paragraphId: string; reason?: string; instruction?: string }>
    const userIntention = priorResult?.userIntention as string | undefined
    const rewrites = actions.filter(a => a.type === 'rewrite')
    const deletes = actions.filter(a => a.type === 'delete')

    const lines = [`[agentclick] Sub-agent rewrite complete (round ${newRevision}):`]
    if (deletes.length > 0) lines.push(`- Removed ${deletes.length} paragraph(s): ${deletes.map(a => a.paragraphId).join(', ')}`)
    if (rewrites.length > 0) lines.push(`- Rewrote: ${rewrites.map(a => `${a.paragraphId} — "${a.instruction}"`).join(', ')}`)
    if (userIntention) lines.push(`- User intention: "${userIntention}"`)
    lines.push('- Draft updated. Waiting for user to review.')

    callWebhook({ message: lines.join('\n'), sessionKey: session.sessionKey, deliver: false })
      .then(() => console.log(`[agentclick] Rewrite progress notified to main agent (round ${newRevision})`))
      .catch(err => console.warn(`[agentclick] Failed to notify main agent of rewrite progress:`, err))
  }

  res.json({ ok: true, revision: newRevision })
})

// Web UI submits user actions
app.post('/api/sessions/:id/complete', async (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  // If user requested regeneration, set to rewriting (not completed) so agent can update
  if (req.body.regenerate) {
    setSessionRewriting(req.params.id, req.body)
    console.log(`[agentclick] Session ${session.id} → rewriting:`, JSON.stringify(req.body, null, 2))
    res.json({ ok: true, rewriting: true })
    return
  }

  completeSession(req.params.id, req.body)

  console.log(`[agentclick] Session ${session.id} completed:`, JSON.stringify(req.body, null, 2))

  // Learn from delete actions and persist rules to MEMORY.md
  const actions = (req.body.actions ?? []) as Array<{ type: string; paragraphId: string; reason?: string; instruction?: string }>
  learnFromDeletions(actions, session.payload as Record<string, unknown>)

  // Learn from trajectory revisions
  const revisions = req.body.revisions as Array<{ stepId: string; action: 'mark_wrong' | 'provide_guidance' | 'skip'; correction?: string; guidance?: string; shouldLearn?: boolean }> | undefined
  if (revisions && revisions.length > 0) {
    learnFromTrajectoryRevisions(revisions, session.payload as { title: string; steps: Array<{ id: string; label: string }> })
  }

  // Send result back to OpenClaw
  let callbackFailed = false
  let callbackError = ''

  if (session.sessionKey) {
    try {
      const summary = buildActionSummary(req.body)
      await callWebhook({ message: summary, sessionKey: session.sessionKey, deliver: true })
      console.log(`[agentclick] Callback sent to OpenClaw`)
    } catch (err) {
      callbackFailed = true
      callbackError = String(err)
      console.error(`[agentclick] Failed to callback OpenClaw:`, err)
    }
  }

  res.json({ ok: true, callbackFailed, callbackError })
})

async function callWebhook(body: Record<string, unknown>): Promise<void> {
  await fetch(OPENCLAW_WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN || ''}`,
    },
    body: JSON.stringify(body),
  })
}

function buildActionSummary(result: Record<string, unknown>): string {
  // Trajectory review: has revisions array
  if ('revisions' in result && Array.isArray(result.revisions)) {
    const approved = result.approved as boolean
    const revisions = result.revisions as Array<{ stepId: string; action: string; correction?: string; guidance?: string }>
    const globalNote = result.globalNote as string | undefined
    const resumeFromStep = result.resumeFromStep as string | undefined
    const lines = ['[agentclick] User reviewed the trajectory:']
    lines.push(approved ? '- Approved: proceed.' : '- Rejected: do not proceed.')
    const wrong = revisions.filter(r => r.action === 'mark_wrong')
    const guided = revisions.filter(r => r.action === 'provide_guidance')
    if (wrong.length > 0) lines.push(`- Marked ${wrong.length} step(s) as wrong: ${wrong.map(r => `${r.stepId}${r.correction ? ` — "${r.correction}"` : ''}`).join(', ')}`)
    if (guided.length > 0) lines.push(`- Guidance for ${guided.length} step(s): ${guided.map(r => `${r.stepId} — "${r.guidance}"`).join(', ')}`)
    if (resumeFromStep) lines.push(`- Resume from step: ${resumeFromStep}`)
    if (globalNote) lines.push(`- Note: ${globalNote}`)
    return lines.join('\n')
  }

  // If result has approved field, it's an action_approval or code_review
  if ('approved' in result) {
    const approved = result.approved as boolean
    const note = result.note as string | undefined
    const lines = ['[agentclick] User reviewed the request:']
    lines.push(approved ? '- Approved: proceed.' : '- Rejected: do not proceed.')
    if (note) lines.push(`- Note: ${note}`)
    return lines.join('\n')
  }

  const actions = result.actions as Array<{ type: string; paragraphId: string; reason?: string; instruction?: string }> || []
  const lines = ['[agentclick] User reviewed the draft:']

  const deleted = actions.filter(a => a.type === 'delete')
  const rewritten = actions.filter(a => a.type === 'rewrite')

  if (deleted.length > 0) {
    lines.push(`- Deleted ${deleted.length} paragraph(s): ${deleted.map(a => `${a.paragraphId} (reason: ${a.reason})`).join(', ')}`)
  }
  if (rewritten.length > 0) {
    lines.push(`- Requested rewrite for: ${rewritten.map(a => `${a.paragraphId} — "${a.instruction}"`).join(', ')}`)
  }
  if (result.confirmed) {
    lines.push('- User confirmed: proceed with sending.')
  }
  if (result.regenerate) {
    lines.push('- User requested full regeneration.')
  }

  const intents = (result.selectedIntents ?? []) as Array<{ id: string; accepted: boolean }>
  if (intents.length > 0) {
    lines.push(`- Intent decisions: ${intents.map(i => `${i.id} → ${i.accepted ? 'accepted' : 'rejected'}`).join(', ')}`)
  }

  return lines.join('\n')
}

if (SHOULD_SERVE_BUILT_WEB) {
  app.use(express.static(WEB_DIST_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(join(WEB_DIST_DIR, 'index.html'))
  })
  console.log(`[agentclick] Serving web UI from ${WEB_DIST_DIR}`)
}

app.listen(PORT, () => {
  console.log(`[agentclick] Server running at http://localhost:${PORT}`)
})
