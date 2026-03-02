import fs from 'fs'
import path from 'path'
import os from 'os'

const MEMORY_PATH = path.join(os.homedir(), '.openclaw', 'workspace', 'MEMORY.md')
const SECTION_HEADER = '## Email Preferences (ClawUI Auto-Learned)'

interface Paragraph {
  id: string
  content: string
}

interface SessionPayload {
  type?: string
  paragraphs?: Paragraph[]
  [key: string]: unknown
}

interface ReviewAction {
  type: string
  paragraphId: string
  reason?: string
  instruction?: string
}

// Map raw reason keys to human-readable descriptions
const REASON_LABELS: Record<string, string> = {
  too_formal: 'too formal',
  too_casual: 'too casual',
  too_long: 'too long',
  off_topic: 'off topic',
  inaccurate: 'inaccurate',
  repetitive: 'repetitive',
  unnecessary: 'unnecessary',
  wrong_tone: 'wrong tone',
  too_polite: 'too polite',
  redundant: 'redundant',
}

function ensureMemoryFile(): void {
  const dir = path.dirname(MEMORY_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(MEMORY_PATH, '# ClawUI Learned Preferences\n', 'utf-8')
  }
}

// Truncate paragraph content into a short description for the rule
function summarize(content: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ')
  if (cleaned.length <= 80) return cleaned
  return cleaned.slice(0, 77) + '...'
}

function resolveReason(reason: string | undefined): string {
  if (!reason) return 'user deleted'
  return REASON_LABELS[reason] ?? reason
}

export function learnFromDeletions(
  actions: ReviewAction[],
  payload: SessionPayload
): void {
  const deletions = actions.filter(a => a.type === 'delete')
  if (deletions.length === 0) return

  const paragraphMap = new Map<string, string>(
    (payload.paragraphs ?? []).map(p => [p.id, p.content])
  )

  // Infer scope from session type
  const scope = payload.type === 'email_review' ? 'email' : 'general'

  const rules: string[] = []
  for (const action of deletions) {
    const content = paragraphMap.get(action.paragraphId)
    // Skip if we cannot find the original paragraph text
    if (!content) continue

    const description = summarize(content)
    const reason = resolveReason(action.reason)
    rules.push(`- AVOID: ${description} (reason: ${reason}) - SCOPE: ${scope}`)
  }

  if (rules.length === 0) return

  ensureMemoryFile()

  const existing = fs.readFileSync(MEMORY_PATH, 'utf-8')

  // Append section header once if not present, then append rules
  const needsHeader = !existing.includes(SECTION_HEADER)
  const block = needsHeader
    ? `\n${SECTION_HEADER}\n${rules.join('\n')}\n`
    : `${rules.join('\n')}\n`

  fs.appendFileSync(MEMORY_PATH, block, 'utf-8')
  console.log(`[agentclick] Learned ${rules.length} preference rule(s) -> ${MEMORY_PATH}`)
}

export interface LearnedPreference {
  description: string
  reason: string
  scope: string
}

export function getLearnedPreferences(): LearnedPreference[] {
  if (!fs.existsSync(MEMORY_PATH)) return []

  const content = fs.readFileSync(MEMORY_PATH, 'utf-8')
  const sectionStart = content.indexOf(SECTION_HEADER)
  if (sectionStart === -1) return []

  const sectionContent = content.slice(sectionStart + SECTION_HEADER.length)
  const preferences: LearnedPreference[] = []

  for (const line of sectionContent.split('\n')) {
    const match = line.match(/^- AVOID: (.+?) \(reason: (.+?)\) - SCOPE: (.+)$/)
    if (match) {
      preferences.push({
        description: match[1].trim(),
        reason: match[2].trim(),
        scope: match[3].trim(),
      })
    }
  }

  return preferences
}

export function deletePreference(index: number): void {
  if (!fs.existsSync(MEMORY_PATH)) return

  const content = fs.readFileSync(MEMORY_PATH, 'utf-8')
  const lines = content.split('\n')
  const headerIdx = lines.findIndex(l => l === SECTION_HEADER)
  if (headerIdx === -1) return

  let endIdx = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break }
  }

  // Collect indices of AVOID lines in the section
  const avoidLineIndices: number[] = []
  for (let i = headerIdx + 1; i < endIdx; i++) {
    if (lines[i].match(/^- AVOID:/)) avoidLineIndices.push(i)
  }

  if (index < 0 || index >= avoidLineIndices.length) return

  lines.splice(avoidLineIndices[index], 1)
  fs.writeFileSync(MEMORY_PATH, lines.join('\n'), 'utf-8')
}

export function clearPreferences(): void {
  if (!fs.existsSync(MEMORY_PATH)) return

  const content = fs.readFileSync(MEMORY_PATH, 'utf-8')
  const lines = content.split('\n')
  const headerIdx = lines.findIndex(l => l === SECTION_HEADER)
  if (headerIdx === -1) return

  // Find start of next ## section (or end of file)
  let endIdx = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break }
  }

  // Also remove a preceding blank line if present
  const start = headerIdx > 0 && lines[headerIdx - 1] === '' ? headerIdx - 1 : headerIdx
  lines.splice(start, endIdx - start)

  fs.writeFileSync(MEMORY_PATH, lines.join('\n'), 'utf-8')
}
