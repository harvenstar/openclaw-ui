import fs from 'fs'
import os from 'os'
import path from 'path'

type MemoryCategory = 'current_content' | 'project' | 'agent_cache' | 'related_markdown' | 'pinned' | 'search_result'

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
  pinnedByPreference: boolean
  matchedBySearch: boolean
  preview: string
  sections: Array<{ id: string; title: string }>
  guidance: string
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
  persistedIncludedPaths: string[]
  persistedDirectoryPaths: string[]
  searchQuery?: string
}

export interface MemoryCatalogPayload {
  groups: Array<{ id: string; label: string; fileIds: string[] }>
  files: MemoryFileItem[]
  defaultIncludedFileIds: string[]
  persistedIncludedPaths: string[]
  persistedDirectoryPaths: string[]
  searchQuery?: string
}

export interface MemoryResolveResult {
  files: Array<{ path: string; relativePath: string }>
  directories: string[]
  ignoredInputs: string[]
}

interface MemoryPreferenceState {
  includedPaths: string[]
  includedDirectories: string[]
  fileGuidance: Record<string, string>
}

const MEMORY_INCLUDE_STATE_PATH = path.join(os.homedir(), '.openclaw', 'agentclick-memory-includes.json')

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

function normalizePreferenceState(raw: unknown): MemoryPreferenceState {
  const parsed = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const includedPaths = Array.isArray(parsed.includedPaths)
    ? parsed.includedPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const includedDirectories = Array.isArray(parsed.includedDirectories)
    ? parsed.includedDirectories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const fileGuidance = (parsed.fileGuidance && typeof parsed.fileGuidance === 'object' && !Array.isArray(parsed.fileGuidance))
    ? Object.fromEntries(Object.entries(parsed.fileGuidance as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {}
  return { includedPaths, includedDirectories, fileGuidance }
}

function readMemoryPreferenceState(): MemoryPreferenceState {
  try {
    if (!fs.existsSync(MEMORY_INCLUDE_STATE_PATH)) return { includedPaths: [], includedDirectories: [], fileGuidance: {} }
    const raw = fs.readFileSync(MEMORY_INCLUDE_STATE_PATH, 'utf-8')
    return normalizePreferenceState(JSON.parse(raw))
  } catch {
    return { includedPaths: [], includedDirectories: [], fileGuidance: {} }
  }
}

function writeMemoryPreferenceState(state: MemoryPreferenceState): void {
  const dir = path.dirname(MEMORY_INCLUDE_STATE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(MEMORY_INCLUDE_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
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
  // Scan ~/.claude/projects/*/memory/*.md
  const claudeProjectsDir = path.join(home, '.claude', 'projects')
  try {
    if (fs.existsSync(claudeProjectsDir) && fs.statSync(claudeProjectsDir).isDirectory()) {
      const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
      for (const entry of projectDirs) {
        if (!entry.isDirectory()) continue
        const memoryDir = path.join(claudeProjectsDir, entry.name, 'memory')
        try {
          if (fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory()) {
            const mdFiles = fs.readdirSync(memoryDir).filter(f => f.toLowerCase().endsWith('.md'))
            for (const mdFile of mdFiles) {
              candidates.push(path.join(memoryDir, mdFile))
            }
          }
        } catch {
          continue
        }
      }
    }
  } catch {
    // ignore errors scanning claude projects
  }
  return candidates.filter(p => {
    try { return fs.existsSync(p) && fs.statSync(p).isFile() } catch { return false }
  })
}

function collectAutoContextFiles(projectRoot: string): string[] {
  const auto: string[] = []
  // CLAUDE.md in project root and up to 3 parent dirs
  let dir = projectRoot
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'CLAUDE.md')
    if (fs.existsSync(candidate)) auto.push(candidate)
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // MEMORY.md in project root
  const memoryMd = path.join(projectRoot, 'MEMORY.md')
  if (fs.existsSync(memoryMd)) auto.push(memoryMd)
  // Agent cache memory files (these are also "in context" for the agent)
  auto.push(...collectAgentCacheMemoryFiles())
  // Persisted included paths
  const prefs = readMemoryPreferenceState()
  auto.push(...prefs.includedPaths)
  return auto
}

function toId(value: string): string {
  return `mem_${Buffer.from(value).toString('base64url')}`
}

function uniqueSortedPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(p => path.resolve(p)))).sort()
}

function normalizeInputPath(projectRoot: string, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(projectRoot, trimmed))
}

function isMarkdownFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.md')
}

function filterFilesBySearch(files: MemoryFileItem[], query?: string): MemoryFileItem[] {
  if (!query || !query.trim()) return files
  const needle = query.trim().toLowerCase()
  return files.filter(file =>
    file.path.toLowerCase().includes(needle)
    || file.relativePath.toLowerCase().includes(needle)
    || file.preview.toLowerCase().includes(needle)
    || file.sections.some(section => section.title.toLowerCase().includes(needle))
  )
}

function buildGroups(files: MemoryFileItem[]): Array<{ id: string; label: string; fileIds: string[] }> {
  return [
    {
      id: 'group_pinned_memory',
      label: 'Pinned Memory',
      fileIds: files.filter(f => f.pinnedByPreference).map(f => f.id),
    },
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
      id: 'group_search_result',
      label: 'Searched Markdown',
      fileIds: files.filter(f => f.matchedBySearch).map(f => f.id),
    },
    {
      id: 'group_related_markdown',
      label: 'Related Markdown',
      fileIds: files.filter(f => f.relatedMarkdown).map(f => f.id),
    },
  ].filter(group => group.fileIds.length > 0)
}

function collectExtraMarkdownFiles(projectRoot: string, extraMarkdownDirs?: string[]): string[] {
  const extraFiles: string[] = []
  for (const dir of extraMarkdownDirs ?? []) {
    const resolved = normalizeInputPath(projectRoot, dir)
    if (!resolved || !fs.existsSync(resolved)) continue
    try {
      const stat = fs.statSync(resolved)
      if (stat.isFile() && isMarkdownFile(resolved)) {
        extraFiles.push(resolved)
      } else if (stat.isDirectory()) {
        extraFiles.push(...walkMarkdownFiles(resolved, { maxFiles: 400 }))
      }
    } catch {
      continue
    }
  }
  return uniqueSortedPaths(extraFiles)
}

export function buildMemoryCatalog(input: {
  projectRoot: string
  currentContextFiles?: string[]
  extraMarkdownDirs?: string[]
  extraFilePaths?: string[]
  searchQuery?: string
}): MemoryCatalogPayload {
  const projectRoot = input.projectRoot
  const preferenceState = readMemoryPreferenceState()
  const persistedIncludes = uniqueSortedPaths(preferenceState.includedPaths)
  const persistedDirectories = uniqueSortedPaths(preferenceState.includedDirectories)
  const dynamicDirectories = uniqueSortedPaths([
    ...persistedDirectories,
    ...((input.extraMarkdownDirs ?? []).map(dir => normalizeInputPath(projectRoot, dir)).filter(Boolean)),
  ])
  const autoContext = input.currentContextFiles
    ? input.currentContextFiles.map(p => normalizeInputPath(projectRoot, p))
    : collectAutoContextFiles(projectRoot).map(p => normalizeInputPath(projectRoot, p))
  const currentContextSet = new Set([
    ...persistedIncludes,
    ...autoContext,
    ...(input.extraFilePaths ?? []).map(p => normalizeInputPath(projectRoot, p)).filter(Boolean),
  ])
  const relatedMarkdown = uniqueSortedPaths([
    ...walkMarkdownFiles(projectRoot, { maxFiles: 220 }),
    ...collectExtraMarkdownFiles(projectRoot, dynamicDirectories),
  ])
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
  for (const p of persistedIncludes) {
    if (!byPath.has(p)) byPath.set(p, new Set())
    byPath.get(p)!.add('pinned')
  }

  const files: MemoryFileItem[] = []
  for (const [absPath, categorySet] of byPath.entries()) {
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(absPath)
    } catch {
      stat = null
    }
    if (!stat?.isFile()) continue
    const content = safeRead(absPath, 18000)
    const categories = Array.from(categorySet.values())
    files.push({
      id: toId(absPath),
      path: absPath,
      relativePath: absPath.startsWith(projectRoot) ? path.relative(projectRoot, absPath) : absPath,
      size: stat.size,
      lastModified: stat.mtimeMs,
      categories,
      inCurrentContent: categorySet.has('current_content'),
      inProject: categorySet.has('project'),
      inAgentCache: categorySet.has('agent_cache'),
      relatedMarkdown: categorySet.has('related_markdown'),
      pinnedByPreference: categorySet.has('pinned'),
      matchedBySearch: false,
      preview: firstPreview(content),
      sections: parseSections(content),
      guidance: preferenceState.fileGuidance[absPath] ?? '',
    })
  }

  const searchedFiles = filterFilesBySearch(files, input.searchQuery).map(file => ({
    ...file,
    categories: file.categories.includes('search_result') ? file.categories : [...file.categories, 'search_result' as const],
    matchedBySearch: !!input.searchQuery?.trim(),
  }))

  searchedFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const groups = buildGroups(searchedFiles)
  const defaultIncludedFileIds = searchedFiles
    .filter(f => f.inCurrentContent || f.pinnedByPreference || f.inProject || f.inAgentCache)
    .map(f => f.id)

  return {
    groups,
    files: searchedFiles,
    defaultIncludedFileIds,
    persistedIncludedPaths: persistedIncludes,
    persistedDirectoryPaths: dynamicDirectories,
    searchQuery: input.searchQuery?.trim() || undefined,
  }
}

export function resolveMemoryInput(input: {
  projectRoot: string
  rawInput: string
}): MemoryResolveResult {
  const files = new Map<string, { path: string; relativePath: string }>()
  const directories = new Set<string>()
  const ignoredInputs: string[] = []

  for (const token of input.rawInput.split('\n').map(line => line.trim()).filter(Boolean)) {
    const resolved = normalizeInputPath(input.projectRoot, token)
    if (!resolved || !fs.existsSync(resolved)) {
      ignoredInputs.push(token)
      continue
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(resolved)
    } catch {
      ignoredInputs.push(token)
      continue
    }
    if (stat.isDirectory()) {
      directories.add(resolved)
      for (const filePath of walkMarkdownFiles(resolved, { maxFiles: 400 })) {
        files.set(filePath, {
          path: filePath,
          relativePath: filePath.startsWith(input.projectRoot) ? path.relative(input.projectRoot, filePath) : filePath,
        })
      }
      continue
    }
    if (stat.isFile() && isMarkdownFile(resolved)) {
      files.set(resolved, {
        path: resolved,
        relativePath: resolved.startsWith(input.projectRoot) ? path.relative(input.projectRoot, resolved) : resolved,
      })
      continue
    }
    ignoredInputs.push(token)
  }

  return {
    files: Array.from(files.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    directories: Array.from(directories.values()).sort(),
    ignoredInputs,
  }
}

export function readMemoryFileContent(input: {
  projectRoot: string
  filePath: string
  currentContextFiles?: string[]
  extraMarkdownDirs?: string[]
  extraFilePaths?: string[]
}): { path: string; relativePath: string; content: string } | null {
  const catalog = buildMemoryCatalog({
    projectRoot: input.projectRoot,
    currentContextFiles: input.currentContextFiles,
    extraMarkdownDirs: input.extraMarkdownDirs,
    extraFilePaths: input.extraFilePaths,
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

export function includeMemoryFileInContext(input: {
  projectRoot: string
  filePath: string
  persist?: boolean
}): { ok: boolean; includedPaths: string[]; includedDirectories: string[] } {
  const catalog = buildMemoryCatalog({ projectRoot: input.projectRoot })
  const target = catalog.files.find(f => path.resolve(f.path) === path.resolve(input.filePath))
  if (!target) {
    const state = readMemoryPreferenceState()
    return { ok: false, includedPaths: state.includedPaths, includedDirectories: state.includedDirectories }
  }
  const state = readMemoryPreferenceState()
  const current = new Set(state.includedPaths.map(p => path.resolve(p)))
  current.add(path.resolve(target.path))
  const nextState: MemoryPreferenceState = {
    includedPaths: uniqueSortedPaths(Array.from(current.values())),
    includedDirectories: uniqueSortedPaths(state.includedDirectories),
    fileGuidance: state.fileGuidance,
  }
  if (input.persist !== false) writeMemoryPreferenceState(nextState)
  return { ok: true, includedPaths: nextState.includedPaths, includedDirectories: nextState.includedDirectories }
}

export function removeMemoryFileFromContext(input: {
  projectRoot: string
  filePath: string
}): { ok: boolean; includedPaths: string[]; includedDirectories: string[] } {
  const catalog = buildMemoryCatalog({ projectRoot: input.projectRoot })
  const target = catalog.files.find(f => path.resolve(f.path) === path.resolve(input.filePath))
  if (!target) {
    const state = readMemoryPreferenceState()
    return { ok: false, includedPaths: state.includedPaths, includedDirectories: state.includedDirectories }
  }
  const state = readMemoryPreferenceState()
  const current = new Set(state.includedPaths.map(p => path.resolve(p)))
  current.delete(path.resolve(target.path))
  const nextState: MemoryPreferenceState = {
    includedPaths: uniqueSortedPaths(Array.from(current.values())),
    includedDirectories: uniqueSortedPaths(state.includedDirectories),
    fileGuidance: state.fileGuidance,
  }
  writeMemoryPreferenceState(nextState)
  return { ok: true, includedPaths: nextState.includedPaths, includedDirectories: nextState.includedDirectories }
}

export function updateMemoryPreferences(input: {
  projectRoot: string
  includedPaths?: string[]
  includedDirectories?: string[]
}): MemoryPreferenceState {
  const state = readMemoryPreferenceState()
  const nextState: MemoryPreferenceState = {
    includedPaths: uniqueSortedPaths(
      (input.includedPaths ?? state.includedPaths).map(value => normalizeInputPath(input.projectRoot, value)).filter(Boolean)
    ),
    includedDirectories: uniqueSortedPaths(
      (input.includedDirectories ?? state.includedDirectories).map(value => normalizeInputPath(input.projectRoot, value)).filter(Boolean)
    ),
    fileGuidance: state.fileGuidance,
  }
  writeMemoryPreferenceState(nextState)
  return nextState
}

export function buildMemoryReviewPayload(input: {
  projectRoot: string
  currentContextFiles?: string[]
  generatedContent?: string
  extraMarkdownDirs?: string[]
  extraFilePaths?: string[]
  searchQuery?: string
}): MemoryReviewPayload {
  const catalog = buildMemoryCatalog({
    projectRoot: input.projectRoot,
    currentContextFiles: input.currentContextFiles,
    extraMarkdownDirs: input.extraMarkdownDirs,
    extraFilePaths: input.extraFilePaths,
    searchQuery: input.searchQuery,
  })
  const { groups, files, defaultIncludedFileIds, persistedIncludedPaths, persistedDirectoryPaths } = catalog

  const targetFile = files.find(f => f.inProject || f.inAgentCache || f.pinnedByPreference) ?? files[0]
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
      file.inCurrentContent || file.inProject || file.inAgentCache || file.pinnedByPreference ? 'include' : 'disregard'
    const reason = recommendation === 'include'
      ? 'Relevant to active context or persistent memory source.'
      : 'Related markdown outside core memory paths; safe to disregard after compression.'
    return { fileId: file.id, recommendation, reason }
  })

  return {
    title: 'Memory Review',
    description: 'Review memory sources, search markdown directories, pin files for future sessions, and inspect proposed memory updates.',
    groups,
    files,
    defaultIncludedFileIds,
    modifications,
    compressionRecommendations,
    persistedIncludedPaths,
    persistedDirectoryPaths,
    searchQuery: input.searchQuery?.trim() || undefined,
  }
}

export function readFileGuidance(filePath: string): string {
  const state = readMemoryPreferenceState()
  return state.fileGuidance[path.resolve(filePath)] ?? ''
}

export function writeFileGuidance(filePath: string, guidance: string): void {
  const state = readMemoryPreferenceState()
  const next: MemoryPreferenceState = {
    ...state,
    fileGuidance: { ...state.fileGuidance, [path.resolve(filePath)]: guidance },
  }
  writeMemoryPreferenceState(next)
}
