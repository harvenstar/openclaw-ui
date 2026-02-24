import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import open from 'open'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { learnFromDeletions } from './preference.js'
import { createSession, getSession, listSessions, completeSession, setSessionRewriting, updateSessionPayload } from './store.js'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const OPENCLAW_WEBHOOK = process.env.OPENCLAW_WEBHOOK || 'http://localhost:18789/hooks/agent'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WEB_DIST_DIR = join(__dirname, '../../web/dist')
const SHOULD_SERVE_BUILT_WEB = existsSync(WEB_DIST_DIR) && (__filename.endsWith('/dist/index.js') || process.env.NODE_ENV === 'production')
const WEB_ORIGIN = SHOULD_SERVE_BUILT_WEB ? `http://localhost:${PORT}` : 'http://localhost:5173'

app.use(cors())
app.use(express.json())

// OpenClaw calls this when a review is needed
app.post('/api/review', async (req, res) => {
  const { type, sessionKey, payload } = req.body

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
  }
  const path = routeMap[type] ?? 'review'
  const url = `${WEB_ORIGIN}/${path}/${id}`
  console.log(`[agentclick] Review session created: ${id}`)
  console.log(`[agentclick] Opening browser: ${url}`)

  try {
    await open(url)
  } catch (err) {
    console.warn('[agentclick] Failed to open browser:', err)
  }

  res.json({ sessionId: id, url })
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
    }
  })
  res.json(list)
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
  console.log(`[agentclick] Session ${session.id} payload updated, back to pending (revision=${updated?.revision ?? 'unknown'})`)
  res.json({ ok: true })
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

  // Send result back to OpenClaw
  let callbackFailed = false
  let callbackError = ''

  if (session.sessionKey) {
    try {
      const summary = buildActionSummary(req.body)
      await fetch(OPENCLAW_WEBHOOK, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN || ''}`
        },
        body: JSON.stringify({
          message: summary,
          sessionKey: session.sessionKey,
          deliver: true
        })
      })
      console.log(`[agentclick] Callback sent to OpenClaw`)
    } catch (err) {
      callbackFailed = true
      callbackError = String(err)
      console.error(`[agentclick] Failed to callback OpenClaw:`, err)
    }
  }

  res.json({ ok: true, callbackFailed, callbackError })
})

function buildActionSummary(result: Record<string, unknown>): string {
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
