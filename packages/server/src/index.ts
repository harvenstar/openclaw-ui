import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import open from 'open'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { learnFromDeletions, learnFromTrajectoryRevisions, getLearnedPreferences, clearPreferences, deletePreference } from './preference.js'
import { createSession, getSession, listSessions, completeSession, setSessionRewriting, updateSessionPageStatus, updateSessionPayload } from './store.js'
import {
  buildMemoryCatalog,
  buildMemoryReviewPayload,
  includeMemoryFileInContext,
  resolveMemoryInput,
  readMemoryFileContent,
  removeMemoryFileFromContext,
  updateMemoryPreferences,
} from './memory.js'

const app = express()
const DEFAULT_PORT = 38173
const PORT = Number(process.env.AGENTCLICK_PORT || process.env.PORT || DEFAULT_PORT)
const OPENCLAW_WEBHOOK = process.env.OPENCLAW_WEBHOOK || 'http://localhost:18789/hooks/agent'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WEB_DIST_DIR = join(__dirname, '../../web/dist')
const README_PATH = join(__dirname, '../../../README.md')
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

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

function createSessionId(): string {
  let id = ''
  do {
    id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  } while (getSession(id))
  return id
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

app.get('/api/home-info', (_req, res) => {
  const functions = [
    { type: 'action_approval', route: '/approval/:id' },
    { type: 'code_review', route: '/code-review/:id' },
    { type: 'email_review', route: '/review/:id' },
    { type: 'memory_management', route: '/memory-management' },
    { type: 'plan_review', route: '/plan/:id' },
    { type: 'memory_review', route: '/memory/:id' },
    { type: 'trajectory_review', route: '/trajectory/:id' },
    { type: 'form_review', route: '/form-review/:id' },
    { type: 'selection_review', route: '/selection/:id' },
  ]
  let readmeSummary = 'README.md not found.'
  if (existsSync(README_PATH)) {
    const readme = readFileSync(README_PATH, 'utf-8')
    readmeSummary = readme.split('\n').slice(0, 28).join('\n')
  }
  res.json({
    repo: 'https://github.com/agentlayer-io/AgentClick',
    functions,
    readmeSummary,
  })
})

if (!SHOULD_SERVE_BUILT_WEB) {
  app.get('/', (_req, res) => {
    const functions = [
      'action_approval',
      'code_review',
      'email_review',
      'memory_management',
      'plan_review',
      'memory_review',
      'trajectory_review',
      'form_review',
      'selection_review',
    ]
    let readmeSummary = 'README.md not found.'
    if (existsSync(README_PATH)) {
      const readme = readFileSync(README_PATH, 'utf-8')
      readmeSummary = readme.split('\n').slice(0, 40).join('\n')
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentClick Default Page</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f6f7f9; color: #111827; margin: 0; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 28px 16px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
      .chip { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
      pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; overflow: auto; white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
      a { color: #2563eb; text-decoration: none; }
      a:hover { text-decoration: underline; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      p { margin: 0; color: #4b5563; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>AgentClick Default Page</h1>
        <p>Server: <strong>http://localhost:${PORT}</strong> | Frontend: <strong>${escapeHtml(WEB_ORIGIN)}</strong></p>
        <p style="margin-top:8px;"><a href="${escapeHtml(WEB_ORIGIN)}/" target="_blank" rel="noreferrer">Open Frontend Default Page</a> · <a href="https://github.com/agentlayer-io/AgentClick" target="_blank" rel="noreferrer">Open Repository</a></p>
      </div>
      <div class="card">
        <strong>Functions</strong>
        <div class="chips">
          ${functions.map(fn => `<span class="chip">${fn}</span>`).join('')}
        </div>
        <pre>${escapeHtml(readmeSummary)}</pre>
      </div>
    </div>
  </body>
</html>`
    res.status(200).send(html)
  })
}

// OpenClaw calls this when a review is needed
app.post('/api/review', async (req, res) => {
  const { type, sessionKey, payload, noOpen, openHome } = req.body

  if (!sessionKey) {
    console.warn('[agentclick] Warning: sessionKey missing — callback will be skipped')
  }

  const now = Date.now()
  const id = createSessionId()
  createSession({
    id,
    type: type || 'email_review',
    payload,
    sessionKey,
    status: 'pending',
    pageStatus: { state: 'created', updatedAt: now },
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
    memory_review: 'memory',
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
      if (openHome) {
        await open(`${WEB_ORIGIN}/`)
      }
    } catch (err) {
      console.warn('[agentclick] Failed to open browser:', err)
    }
  }

  res.json({ sessionId: id, url })
})

app.get('/api/memory/files', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const currentContextFiles = typeof req.query.currentContextFiles === 'string'
    ? req.query.currentContextFiles.split(',').map(v => v.trim()).filter(Boolean)
    : undefined
  const extraMarkdownDirs = typeof req.query.extraMarkdownDirs === 'string'
    ? req.query.extraMarkdownDirs.split(',').map(v => v.trim()).filter(Boolean)
    : undefined
  const extraFilePaths = typeof req.query.extraFilePaths === 'string'
    ? req.query.extraFilePaths.split(',').map(v => v.trim()).filter(Boolean)
    : undefined
  const searchQuery = typeof req.query.search === 'string' ? req.query.search : undefined
  const catalog = buildMemoryCatalog({ projectRoot, currentContextFiles, extraMarkdownDirs, extraFilePaths, searchQuery })
  res.json(catalog)
})

app.get('/api/memory/file', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const filePath = typeof req.query.path === 'string' ? req.query.path : ''
  const extraMarkdownDirs = typeof req.query.extraMarkdownDirs === 'string'
    ? req.query.extraMarkdownDirs.split(',').map(v => v.trim()).filter(Boolean)
    : undefined
  const extraFilePaths = typeof req.query.extraFilePaths === 'string'
    ? req.query.extraFilePaths.split(',').map(v => v.trim()).filter(Boolean)
    : undefined
  if (!filePath) return res.status(400).json({ error: 'Missing path query' })
  const file = readMemoryFileContent({ projectRoot, filePath, extraMarkdownDirs, extraFilePaths })
  if (!file) return res.status(404).json({ error: 'File not found in memory catalog' })
  res.json(file)
})

app.post('/api/memory/include', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const filePath = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!filePath) return res.status(400).json({ error: 'Missing path in request body' })
  const persist = req.body?.persist !== false
  const result = includeMemoryFileInContext({ projectRoot, filePath, persist })
  if (!result.ok) return res.status(404).json({ error: 'File not found in memory catalog' })
  res.json(result)
})

app.post('/api/memory/exclude', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const filePath = typeof req.body?.path === 'string' ? req.body.path : ''
  if (!filePath) return res.status(400).json({ error: 'Missing path in request body' })
  const result = removeMemoryFileFromContext({ projectRoot, filePath })
  if (!result.ok) return res.status(404).json({ error: 'File not found in memory catalog' })
  res.json(result)
})

app.post('/api/memory/resolve', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const rawInput = typeof req.body?.input === 'string' ? req.body.input : ''
  if (!rawInput.trim()) return res.status(400).json({ error: 'Missing input in request body' })
  res.json(resolveMemoryInput({ projectRoot, rawInput }))
})

app.post('/api/memory/preferences', (req, res) => {
  const projectRoot = join(__dirname, '../../..')
  const includedPaths = Array.isArray(req.body?.includedPaths)
    ? req.body.includedPaths.filter((value: unknown): value is string => typeof value === 'string')
    : undefined
  const includedDirectories = Array.isArray(req.body?.includedDirectories)
    ? req.body.includedDirectories.filter((value: unknown): value is string => typeof value === 'string')
    : undefined
  const result = updateMemoryPreferences({ projectRoot, includedPaths, includedDirectories })
  res.json(result)
})

app.post('/api/memory/review/create', async (req, res) => {
  const { sessionKey, noOpen, openHome, currentContextFiles, generatedContent, extraMarkdownDirs, extraFilePaths, searchQuery } = req.body ?? {}
  const projectRoot = join(__dirname, '../../..')
  const payload = buildMemoryReviewPayload({
    projectRoot,
    currentContextFiles: Array.isArray(currentContextFiles) ? currentContextFiles : undefined,
    generatedContent: typeof generatedContent === 'string' ? generatedContent : undefined,
    extraMarkdownDirs: Array.isArray(extraMarkdownDirs) ? extraMarkdownDirs : undefined,
    extraFilePaths: Array.isArray(extraFilePaths) ? extraFilePaths : undefined,
    searchQuery: typeof searchQuery === 'string' ? searchQuery : undefined,
  })

  const now = Date.now()
  const id = createSessionId()
  createSession({
    id,
    type: 'memory_review',
    payload,
    sessionKey,
    status: 'pending',
    pageStatus: { state: 'created', updatedAt: now },
    createdAt: now,
    updatedAt: now,
    revision: 0,
  })

  const url = `${WEB_ORIGIN}/memory/${id}`
  if (!noOpen) {
    try {
      await open(url)
      if (openHome) await open(`${WEB_ORIGIN}/`)
    } catch (err) {
      console.warn('[agentclick] Failed to open memory review browser tab:', err)
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
    plan_review: 'plan',
    memory_review: 'memory',
  }

  const results = items.map((item: { type?: string; sessionKey?: string; payload?: unknown }) => {
    const { type, sessionKey, payload } = item
    if (!sessionKey) {
      console.warn('[agentclick] Warning: sessionKey missing in batch item — callback will be skipped')
    }
    const now = Date.now()
    const id = createSessionId()
    createSession({
      id,
      type: type || 'email_review',
      payload,
      sessionKey,
      status: 'pending',
      pageStatus: { state: 'created', updatedAt: now },
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

app.post('/api/sessions/:id/page-status', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const state = typeof req.body?.state === 'string' ? req.body.state : ''
  if (!['opened', 'active', 'hidden', 'submitted'].includes(state)) {
    return res.status(400).json({ error: 'Invalid page status state' })
  }
  const pageStatus = { state: state as 'opened' | 'active' | 'hidden' | 'submitted', updatedAt: Date.now() }
  updateSessionPageStatus(req.params.id, pageStatus)
  res.json({ ok: true, pageStatus })
})

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

  const preview = String(email.preview ?? '').trim()
  const structuredSummary = email.summary as string | Record<string, unknown> | undefined

  let summaryText = ''
  let bullets: string[] = []
  let confidence = 'heuristic'

  if (typeof structuredSummary === 'string' && structuredSummary.trim().length > 0) {
    summaryText = structuredSummary.trim()
    confidence = 'agent'
  } else if (structuredSummary && typeof structuredSummary === 'object') {
    const fromObject = structuredSummary as Record<string, unknown>
    const candidateSummary = typeof fromObject.summary === 'string' ? fromObject.summary.trim() : ''
    const candidateBullets = Array.isArray(fromObject.bullets)
      ? fromObject.bullets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const candidateConfidence = typeof fromObject.confidence === 'string' ? fromObject.confidence : ''
    if (candidateSummary) summaryText = candidateSummary
    if (candidateBullets.length > 0) bullets = candidateBullets
    if (candidateConfidence) confidence = candidateConfidence
    if (candidateSummary) confidence = 'agent'
  }

  if (!summaryText) {
    summaryText = preview.length > 0
      ? preview.slice(0, 280)
      : 'No preview text is available for this email yet.'
  }

  if (bullets.length === 0) {
    const from = String(email.from ?? 'Unknown sender')
    const category = String(email.category ?? 'Unknown')
    const subject = String(email.subject ?? 'No subject')
    bullets = [
      `From: ${from}`,
      `Category: ${category}`,
      `Subject: ${subject}`,
    ]
  }

  res.json({
    emailId,
    summary: summaryText,
    bullets,
    confidence,
  })
})

// Long-poll: agent calls this and blocks until user completes review (up to 5 min)
app.get('/api/sessions/:id/wait', async (req, res) => {
  const TIMEOUT_MS = 5 * 60 * 1000
  const POLL_MS = 500
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
    updateSessionPageStatus(req.params.id, { state: 'submitted', updatedAt: Date.now() })
    console.log(`[agentclick] Session ${session.id} → rewriting:`, JSON.stringify(req.body, null, 2))
    res.json({ ok: true, rewriting: true })
    return
  }

  completeSession(req.params.id, req.body)
  updateSessionPageStatus(req.params.id, { state: 'submitted', updatedAt: Date.now() })

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

  if ('includedFileIds' in result || 'persistedIncludedPaths' in result || 'persistedDirectoryPaths' in result) {
    const approved = result.approved as boolean
    const globalNote = result.globalNote as string | undefined
    const includedFileIds = Array.isArray(result.includedFileIds) ? result.includedFileIds.length : 0
    const disregardedFileIds = Array.isArray(result.disregardedFileIds) ? result.disregardedFileIds.length : 0
    const persistedIncludedPaths = Array.isArray(result.persistedIncludedPaths)
      ? result.persistedIncludedPaths.filter((item): item is string => typeof item === 'string')
      : []
    const persistedDirectoryPaths = Array.isArray(result.persistedDirectoryPaths)
      ? result.persistedDirectoryPaths.filter((item): item is string => typeof item === 'string')
      : []
    const pageStatus = result.pageStatus && typeof result.pageStatus === 'object'
      ? result.pageStatus as Record<string, unknown>
      : undefined
    const lines = ['[agentclick] User reviewed memory sources:']
    lines.push(approved ? '- Approved: proceed.' : '- Rejected: do not proceed.')
    lines.push(`- Included files in context: ${includedFileIds}`)
    lines.push(`- Disregarded files after compression: ${disregardedFileIds}`)
    if (persistedIncludedPaths.length > 0) lines.push(`- Persisted pinned files: ${persistedIncludedPaths.join(', ')}`)
    if (persistedDirectoryPaths.length > 0) lines.push(`- Persisted markdown directories: ${persistedDirectoryPaths.join(', ')}`)
    if (pageStatus?.state) lines.push(`- Page status before submit: ${String(pageStatus.state)}`)
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
  if (result.readMore) {
    const requestedCategories = Array.isArray(result.requestedCategories)
      ? result.requestedCategories.filter((item): item is string => typeof item === 'string')
      : []
    lines.push(`- User requested more emails${requestedCategories.length > 0 ? ` for categories: ${requestedCategories.join(', ')}` : ''}.`)
  }

  const intents = (result.selectedIntents ?? []) as Array<{ id: string; accepted: boolean }>
  if (intents.length > 0) {
    lines.push(`- Intent decisions: ${intents.map(i => `${i.id} → ${i.accepted ? 'accepted' : 'rejected'}`).join(', ')}`)
  }

  const unreadEmailCount = typeof result.unreadEmailCount === 'number' ? result.unreadEmailCount : null
  if (unreadEmailCount !== null) {
    lines.push(`- Remaining unread emails: ${unreadEmailCount}`)
  }

  const markedAsReadDetails = Array.isArray(result.markedAsReadDetails)
    ? result.markedAsReadDetails.filter((item): item is { id?: string; from?: string; subject?: string } => !!item && typeof item === 'object')
    : []
  if (markedAsReadDetails.length > 0) {
    lines.push(`- Marked as read: ${markedAsReadDetails.map(item => `${item.subject ?? item.id ?? 'unknown'}${item.from ? ` from ${item.from}` : ''}`).join(', ')}`)
  }

  const editedDraft = result.editedDraft && typeof result.editedDraft === 'object'
    ? result.editedDraft as Record<string, unknown>
    : null
  if (editedDraft) {
    const draftTo = typeof editedDraft.to === 'string' ? editedDraft.to : ''
    const draftSubject = typeof editedDraft.subject === 'string' ? editedDraft.subject : ''
    const cc = Array.isArray(editedDraft.cc) ? editedDraft.cc.filter((item): item is string => typeof item === 'string') : []
    const bcc = Array.isArray(editedDraft.bcc) ? editedDraft.bcc.filter((item): item is string => typeof item === 'string') : []
    lines.push(`- Edited draft ready${draftTo ? ` to ${draftTo}` : ''}${draftSubject ? ` with subject "${draftSubject}"` : ''}.`)
    if (cc.length > 0) lines.push(`- Added Cc: ${cc.join(', ')}`)
    if (bcc.length > 0) lines.push(`- Added Bcc: ${bcc.join(', ')}`)
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
