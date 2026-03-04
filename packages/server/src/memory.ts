import fs from 'fs'
import os from 'os'
import path from 'path'

type MemoryCategory = 'current_content' | 'project' | 'agent_cache' | 'related_markdown'

export interface MemoryFileItem {
  id: string
  path: string
  relativePath: string
  size: number
  lastModified: number
  categories: MemoryCategory[]
  inCurrentContent: boolean
  inProject: boolean
  inAgentCache: boolean
  relatedMarkdown: boolean
  preview: string
  sections: Array<{ id: string; title: string }>
}

export interface MemoryModification {
  id: string
  fileId: string
  filePath: string
  location: string
  oldContent: string
  newContent: string
  generatedContent: string
}

export interface CompressionRecommendation {
  fileId: string
  recommendation: 'include' | 'disregard'
  reason: string
}

export interface MemoryReviewPayload {
  title: string
  description: string
  groups: Array<{ id: string; label: string; fileIds: string[] }>
  files: MemoryFileItem[]
  defaultIncludedFileIds: string[]
  modifications: MemoryModification[]
  compressionRecommendations: CompressionRecommendation[]
}

export interface MemoryCatalogPayload {
  groups: Array<{ id: string; label: string; fileIds: string[] }>
  files: MemoryFileItem[]
  defaultIncludedFileIds: string[]
}

function walkMarkdownFiles(baseDir: string, options?: { maxFiles?: number }): string[] {
  const maxFiles = options?.maxFiles ?? 200
  const output: string[] = []
  const skipDir = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo'])

  function walk(dir: string): void {
    if (output.length >= maxFiles) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (output.length >= maxFiles) break
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (skipDir.has(entry.name)) continue
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.toLowerCase().endsWith('.md')) {
        output.push(fullPath)
      }
    }
  }

  walk(baseDir)
  return output
}

function safeRead(filePath: string, maxChars = 12000): string {
  try {
    return fs.readFileSync(filePath, 'utf-8').slice(0, maxChars)
  } catch {
    return ''
  }
}

function parseSections(markdown: string): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = []
  const lines = markdown.split('\n')
  let n = 0
  for (const line of lines) {
    if (!line.startsWith('#')) continue
    const title = line.replace(/^#+\s*/, '').trim()
    if (!title) continue
    n += 1
    out.push({ id: `sec_${n}`, title })
    if (out.length >= 30) break
  }
  return out
}

function firstPreview(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 4)
  return lines.join(' ').slice(0, 220)
}

function collectAgentCacheMemoryFiles(): string[] {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.openclaw', 'workspace', 'MEMORY.md'),
    path.join(home, '.openclaw', 'MEMORY.md'),
    path.join(home, '.codex', 'MEMORY.md'),
  ]
  return candidates.filter(p => fs.existsSync(p) && fs.statSync(p).isFile())
}

function toId(index: number): string {
  return `mem_${index.toString(36)}`
}

export function buildMemoryCatalog(input: {
  projectRoot: string
  currentContextFiles?: string[]
}): MemoryCatalogPayload {
  const projectRoot = input.projectRoot
  const currentContextSet = new Set((input.currentContextFiles ?? []).map(p => path.resolve(projectRoot, p)))
  const relatedMarkdown = walkMarkdownFiles(projectRoot, { maxFiles: 220 })
  const projectMemoryFiles = relatedMarkdown.filter(p => path.basename(p).toLowerCase().includes('memory'))
  const agentCacheFiles = collectAgentCacheMemoryFiles()

  const byPath = new Map<string, Set<MemoryCategory>>()
  for (const p of relatedMarkdown) {
    if (!byPath.has(p)) byPath.set(p, new Set())
    byPath.get(p)!.add('related_markdown')
  }
  for (const p of projectMemoryFiles) {
    if (!byPath.has(p)) byPath.set(p, new Set())
    byPath.get(p)!.add('project')
  }
  for (const p of agentCacheFiles) {
    if (!byPath.has(p)) byPath.set(p, new Set())
    byPath.get(p)!.add('agent_cache')
  }
  for (const p of currentContextSet) {
    if (!byPath.has(p)) byPath.set(p, new Set())
    byPath.get(p)!.add('current_content')
  }

  const files: MemoryFileItem[] = []
  let idx = 0
  for (const [absPath, categorySet] of byPath.entries()) {
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(absPath)
    } catch {
      stat = null
    }
    const content = safeRead(absPath, 18000)
    const categories = Array.from(categorySet.values())
    files.push({
      id: toId(idx++),
      path: absPath,
      relativePath: absPath.startsWith(projectRoot) ? path.relative(projectRoot, absPath) : absPath,
      size: stat?.size ?? 0,
      lastModified: stat?.mtimeMs ?? 0,
      categories,
      inCurrentContent: categorySet.has('current_content'),
      inProject: categorySet.has('project'),
      inAgentCache: categorySet.has('agent_cache'),
      relatedMarkdown: categorySet.has('related_markdown'),
      preview: firstPreview(content),
      sections: parseSections(content),
    })
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  const groups = [
    {
      id: 'group_current_content',
      label: 'In This Content',
      fileIds: files.filter(f => f.inCurrentContent).map(f => f.id),
    },
    {
      id: 'group_project',
      label: 'In This Project',
      fileIds: files.filter(f => f.inProject).map(f => f.id),
    },
    {
      id: 'group_agent_cache',
      label: 'In Agent Cache',
      fileIds: files.filter(f => f.inAgentCache).map(f => f.id),
    },
    {
      id: 'group_related_markdown',
      label: 'Related Markdown',
      fileIds: files.filter(f => f.relatedMarkdown).map(f => f.id),
    },
  ]

  const defaultIncludedFileIds = files
    .filter(f => f.inCurrentContent || f.inProject || f.inAgentCache)
    .map(f => f.id)

  return {
    groups,
    files,
    defaultIncludedFileIds,
  }
}

export function readMemoryFileContent(input: {
  projectRoot: string
  filePath: string
  currentContextFiles?: string[]
}): { path: string; relativePath: string; content: string } | null {
  const catalog = buildMemoryCatalog({
    projectRoot: input.projectRoot,
    currentContextFiles: input.currentContextFiles,
  })
  const target = catalog.files.find(f => path.resolve(f.path) === path.resolve(input.filePath))
  if (!target) return null
  const content = safeRead(target.path, 200000)
  return {
    path: target.path,
    relativePath: target.relativePath,
    content,
  }
}

export function buildMemoryReviewPayload(input: {
  projectRoot: string
  currentContextFiles?: string[]
  generatedContent?: string
}): MemoryReviewPayload {
  const catalog = buildMemoryCatalog({
    projectRoot: input.projectRoot,
    currentContextFiles: input.currentContextFiles,
  })
  const { groups, files, defaultIncludedFileIds } = catalog

  const targetFile = files.find(f => f.inProject || f.inAgentCache) ?? files[0]
  const generatedContent = input.generatedContent
    ?? `## Auto-generated Memory Update (${new Date().toISOString()})\n- Summarized from latest memory review decisions.\n- Keep relevant project guidance and discard noisy markdown.\n`

  const modifications: MemoryModification[] = targetFile ? (() => {
    const oldContent = safeRead(targetFile.path, 24000)
    const newContent = `${oldContent.trimEnd()}\n\n${generatedContent}\n`
    return [{
      id: 'mod_1',
      fileId: targetFile.id,
      filePath: targetFile.path,
      location: targetFile.relativePath,
      oldContent,
      newContent,
      generatedContent,
    }]
  })() : []

  const compressionRecommendations: CompressionRecommendation[] = files.map(file => {
    const recommendation: 'include' | 'disregard' =
      file.inCurrentContent || file.inProject || file.inAgentCache ? 'include' : 'disregard'
    const reason = recommendation === 'include'
      ? 'Relevant to active context or persistent memory source.'
      : 'Related markdown outside core memory paths; safe to disregard after compression.'
    return { fileId: file.id, recommendation, reason }
  })

  return {
    title: 'Memory Review',
    description: 'Review memory sources, include/exclude context files, and inspect proposed memory updates.',
    groups,
    files,
    defaultIncludedFileIds,
    modifications,
    compressionRecommendations,
  }
}
