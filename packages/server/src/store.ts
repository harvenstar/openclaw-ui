import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DB_DIR = join(homedir(), '.openclaw')
const DB_PATH = join(DB_DIR, 'clickui-sessions.db')

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })

const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    pageStatus TEXT,
    sessionKey TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0
  )
`)

// Migrate existing tables: add updatedAt and revision if missing
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0`)
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`)
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN pageStatus TEXT`)
} catch { /* column already exists */ }

export interface SessionPageStatus {
  state: 'created' | 'opened' | 'active' | 'hidden' | 'submitted'
  updatedAt: number
  stopMonitoring?: boolean
  reason?: string
}

export interface Session {
  id: string
  type: string
  payload: unknown
  status: 'pending' | 'rewriting' | 'completed'
  result?: unknown
  pageStatus?: SessionPageStatus
  sessionKey?: string
  createdAt: number
  updatedAt: number
  revision: number
}

export function createSession(session: Session): void {
  db.prepare(`
    INSERT INTO sessions (id, type, payload, status, result, pageStatus, sessionKey, createdAt, updatedAt, revision)
    VALUES (@id, @type, @payload, @status, @result, @pageStatus, @sessionKey, @createdAt, @updatedAt, @revision)
  `).run({
    ...session,
    payload: JSON.stringify(session.payload),
    result: session.result ? JSON.stringify(session.result) : null,
    pageStatus: session.pageStatus ? JSON.stringify(session.pageStatus) : null,
    updatedAt: session.updatedAt || Date.now(),
    revision: session.revision || 0,
  })
}

export function getSession(id: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return deserialize(row)
}

export function listSessions(limit = 20): Session[] {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY createdAt DESC LIMIT ?').all(limit) as Record<string, unknown>[]
  return rows.map(deserialize)
}

export function completeSession(id: string, result: unknown): void {
  db.prepare(`
    UPDATE sessions SET status = 'completed', result = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(result), Date.now(), id)
}

export function setSessionRewriting(id: string, result: unknown): void {
  db.prepare(`
    UPDATE sessions SET status = 'rewriting', result = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(result), Date.now(), id)
}

export function updateSessionPayload(id: string, payload: unknown): void {
  db.prepare(`
    UPDATE sessions SET payload = ?, status = 'pending', result = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ?
  `).run(JSON.stringify(payload), Date.now(), id)
}

export function updateSessionPayloadKeepStatus(id: string, payload: unknown): void {
  db.prepare(`
    UPDATE sessions SET payload = ?, updatedAt = ?, revision = revision + 1 WHERE id = ?
  `).run(JSON.stringify(payload), Date.now(), id)
}

export function updateSessionPageStatus(id: string, pageStatus: SessionPageStatus): void {
  db.prepare(`
    UPDATE sessions SET pageStatus = ?, updatedAt = ? WHERE id = ?
  `).run(JSON.stringify(pageStatus), Date.now(), id)
}

function deserialize(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    type: row.type as string,
    payload: JSON.parse(row.payload as string),
    status: row.status as 'pending' | 'rewriting' | 'completed',
    result: row.result ? JSON.parse(row.result as string) : undefined,
    pageStatus: row.pageStatus ? JSON.parse(row.pageStatus as string) : undefined,
    sessionKey: row.sessionKey as string | undefined,
    createdAt: row.createdAt as number,
    updatedAt: (row.updatedAt as number) || 0,
    revision: (row.revision as number) || 0,
  }
}
