import express from 'express'
import cors from 'cors'
import open from 'open'
import { learnFromDeletions } from './preference'

const app = express()
const PORT = 3001
const OPENCLAW_WEBHOOK = 'http://localhost:18789/hooks/agent'

app.use(cors())
app.use(express.json())

// In-memory session store (good enough for local MVP)
const sessions: Record<string, {
  id: string
  type: string
  payload: unknown
  status: 'pending' | 'completed'
  result?: unknown
  sessionKey?: string
  createdAt: number
}> = {}

// OpenClaw calls this when a review is needed
app.post('/api/review', async (req, res) => {
  const { type, sessionKey, payload } = req.body

  const id = `session_${Date.now()}`
  sessions[id] = {
    id,
    type: type || 'email_review',
    payload,
    sessionKey,
    status: 'pending',
    createdAt: Date.now()
  }

  const routeMap: Record<string, string> = {
    action_approval: 'approval',
    code_review: 'code-review',
  }
  const path = routeMap[type] ?? 'review'
  const url = `http://localhost:5173/${path}/${id}`
  console.log(`[openclaw-ui] Review session created: ${id}`)
  console.log(`[openclaw-ui] Opening browser: ${url}`)

  // Open browser automatically in local mode
  await open(url)

  res.json({ sessionId: id, url })
})

// List recent sessions for homepage
app.get('/api/sessions', (_req, res) => {
  const list = Object.values(sessions)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map(s => {
      const p = s.payload as Record<string, unknown> | undefined
      return {
        id: s.id,
        type: s.type,
        status: s.status,
        createdAt: s.createdAt,
        subject: p?.subject as string | undefined,
        to: p?.to as string | undefined,
      }
    })
  res.json(list)
})

// Web UI fetches session data
app.get('/api/sessions/:id', (req, res) => {
  const session = sessions[req.params.id]
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

// Web UI submits user actions
app.post('/api/sessions/:id/complete', async (req, res) => {
  const session = sessions[req.params.id]
  if (!session) return res.status(404).json({ error: 'Session not found' })

  session.status = 'completed'
  session.result = req.body

  console.log(`[openclaw-ui] Session ${session.id} completed:`, JSON.stringify(req.body, null, 2))

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
      console.log(`[openclaw-ui] Callback sent to OpenClaw`)
    } catch (err) {
      callbackFailed = true
      callbackError = String(err)
      console.error(`[openclaw-ui] Failed to callback OpenClaw:`, err)
    }
  }

  res.json({ ok: true, callbackFailed, callbackError })
})

function buildActionSummary(result: Record<string, unknown>): string {
  // If result has approved field, it's an action_approval or code_review
  if ('approved' in result) {
    const approved = result.approved as boolean
    const note = result.note as string | undefined
    const lines = ['[openclaw-ui] User reviewed the request:']
    lines.push(approved ? '- Approved: proceed.' : '- Rejected: do not proceed.')
    if (note) lines.push(`- Note: ${note}`)
    return lines.join('\n')
  }

  const actions = result.actions as Array<{ type: string; paragraphId: string; reason?: string; instruction?: string }> || []
  const lines = ['[openclaw-ui] User reviewed the draft:']

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

  return lines.join('\n')
}

app.listen(PORT, () => {
  console.log(`[openclaw-ui] Server running at http://localhost:${PORT}`)
})
