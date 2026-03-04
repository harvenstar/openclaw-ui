import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

type CompressionDecision = 'include' | 'disregard'

interface MemoryFile {
  id: string
  path: string
  relativePath: string
  size: number
  lastModified: number
  categories: string[]
  inCurrentContent: boolean
  inProject: boolean
  inAgentCache: boolean
  relatedMarkdown: boolean
  preview: string
  sections: Array<{ id: string; title: string }>
}

interface MemoryGroup {
  id: string
  label: string
  fileIds: string[]
}

interface MemoryModification {
  id: string
  fileId: string
  filePath: string
  location: string
  oldContent: string
  newContent: string
  generatedContent: string
}

interface CompressionRecommendation {
  fileId: string
  recommendation: CompressionDecision
  reason: string
}

interface MemoryPayload {
  title: string
  description?: string
  groups: MemoryGroup[]
  files: MemoryFile[]
  defaultIncludedFileIds: string[]
  modifications: MemoryModification[]
  compressionRecommendations: CompressionRecommendation[]
}

interface MemoryTreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  fileId?: string
  changed: boolean
  children?: MemoryTreeNode[]
}

interface AffectedMemoryFile {
  path: string
  fileId: string
  status: 'modified'
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function computeSimpleDiff(oldText: string, newText: string): Array<{ type: 'context' | 'add' | 'remove'; text: string }> {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const out: Array<{ type: 'context' | 'add' | 'remove'; text: string }> = []

  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    const oldLine = oldLines[i]
    const newLine = newLines[j]

    if (i < oldLines.length && j < newLines.length && oldLine === newLine) {
      out.push({ type: 'context', text: oldLine })
      i += 1
      j += 1
      continue
    }

    if (i < oldLines.length) {
      out.push({ type: 'remove', text: oldLine ?? '' })
      i += 1
    }
    if (j < newLines.length) {
      out.push({ type: 'add', text: newLine ?? '' })
      j += 1
    }
  }
  return out
}

function buildMemoryTree(files: MemoryFile[], changedFileIds: Set<string>): MemoryTreeNode[] {
  type MutableNode = {
    name: string
    path: string
    type: 'dir' | 'file'
    fileId?: string
    changed: boolean
    children?: Map<string, MutableNode>
  }
  const root = new Map<string, MutableNode>()

  for (const file of files) {
    const parts = file.relativePath.split('/').filter(Boolean)
    let current = root
    let currentPath = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part
      let node = current.get(part)
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLeaf ? 'file' : 'dir',
          fileId: isLeaf ? file.id : undefined,
          changed: isLeaf ? changedFileIds.has(file.id) : false,
          children: isLeaf ? undefined : new Map(),
        }
        current.set(part, node)
      }
      if (isLeaf) {
        node.changed = node.changed || changedFileIds.has(file.id)
      } else {
        if (!node.children) node.children = new Map()
        current = node.children
      }
    }
  }

  function toArray(nodes: Map<string, MutableNode>): MemoryTreeNode[] {
    const out: MemoryTreeNode[] = []
    for (const node of nodes.values()) {
      const children = node.children ? toArray(node.children) : undefined
      const changed = node.changed || !!children?.some(c => c.changed)
      out.push({
        name: node.name,
        path: node.path,
        type: node.type,
        fileId: node.fileId,
        changed,
        children,
      })
    }
    return out.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      if (a.changed !== b.changed) return a.changed ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  return toArray(root)
}

const CURVE_W = 36
const CHILD_GAP = 5

function hasChangedDescendant(node: MemoryTreeNode): boolean {
  if (node.changed) return true
  return node.children?.some(hasChangedDescendant) ?? false
}

function bezierD(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) * 0.55
  return `M ${x1},${y1} C ${cx},${y1} ${cx},${y2} ${x2},${y2}`
}

function compressNode(node: MemoryTreeNode): MemoryTreeNode {
  if (node.type !== 'dir' || !node.children) return node
  const children = node.children.map(compressNode)
  const changedDirs = children.filter(c => c.type === 'dir' && c.changed)
  const changedFiles = children.filter(c => c.type === 'file' && c.changed)
  if (changedDirs.length === 1 && changedFiles.length === 0) {
    const only = changedDirs[0]
    return compressNode({ ...node, name: `${node.name}/${only.name}`, path: only.path, children: only.children })
  }
  return { ...node, children }
}

function MemoryMindPill({
  node,
  isHovered,
  isOnPath,
  isExpanded,
  isSelected,
}: {
  node: MemoryTreeNode
  isHovered: boolean
  isOnPath: boolean
  isExpanded?: boolean
  isSelected?: boolean
}) {
  if (node.type === 'file') {
    return (
      <div
        data-pill
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap select-none"
        style={{
          backgroundColor: node.changed ? 'var(--c-pill-m-bg)' : 'var(--c-dir-neutral-bg)',
          border: node.changed
            ? `1.5px solid ${isSelected ? 'var(--c-pill-m-text)' : 'var(--c-pill-m-border)'}`
            : '1px solid var(--c-dir-neutral-border)',
          color: node.changed ? 'var(--c-pill-m-text)' : 'var(--c-dir-neutral-text)',
          boxShadow: isSelected ? '0 0 0 2px var(--c-pill-m-border)' : 'none',
          cursor: 'pointer',
        }}
      >
        {node.changed && <span className="text-[9px] font-bold opacity-70">M</span>}
        <span>{node.name}</span>
      </div>
    )
  }

  const active = isOnPath || isHovered
  const hasChildren = !!node.children?.length
  const changedAware = node.changed && !isHovered
  return (
    <div
      data-pill
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap select-none"
      style={{
        backgroundColor: changedAware ? 'var(--c-dir-diff-bg)' : active ? 'var(--c-dir-active-bg)' : 'var(--c-dir-neutral-bg)',
        border: `1px solid ${changedAware ? 'var(--c-dir-diff-border)' : active ? 'var(--c-dir-active-border)' : 'var(--c-dir-neutral-border)'}`,
        color: changedAware ? 'var(--c-dir-diff-text)' : active ? 'var(--c-dir-active-text)' : 'var(--c-dir-neutral-text)',
        fontWeight: changedAware ? 600 : 500,
      }}
    >
      {hasChildren && (
        <span className="text-[9px] opacity-50" style={{ transition: 'transform 0.2s ease', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▸</span>
      )}
      <span>{node.name}/</span>
    </div>
  )
}

function MemoryMindBranch({
  node,
  collapsedIds,
  onToggleCollapse,
  hoveredPath,
  onHover,
  onLayoutChange,
  onSelectFileByPath,
  selectedFileId,
}: {
  node: MemoryTreeNode
  collapsedIds: Set<string>
  onToggleCollapse: (id: string) => void
  hoveredPath: string | null
  onHover: (path: string | null) => void
  onLayoutChange: () => void
  onSelectFileByPath: (path: string) => void
  selectedFileId: string | null
}) {
  const pillRef = useRef<HTMLDivElement>(null)
  const childrenRef = useRef<HTMLDivElement>(null)
  const [curves, setCurves] = useState<{ parentMid: number; childMids: number[] }>({ parentMid: 12, childMids: [] })
  const hasChildren = !!node.children?.length
  const collapsed = hasChildren ? collapsedIds.has(`changed:${node.path}`) : false
  const expanded = hasChildren ? !collapsed : false
  const selected = node.type === 'file' && node.fileId === selectedFileId
  const totalSlots = expanded ? (node.children?.length ?? 0) : 0
  const isOnHoverPath = hoveredPath != null && (hoveredPath === node.path || hoveredPath.startsWith(node.path + '/'))
  const isHovered = hoveredPath === node.path

  useLayoutEffect(() => {
    if (!pillRef.current || !childrenRef.current || totalSlots === 0) {
      setCurves(prev => prev.childMids.length === 0 ? prev : { parentMid: pillRef.current ? pillRef.current.offsetHeight / 2 : 12, childMids: [] })
      return
    }
    const parentMid = pillRef.current.offsetHeight / 2
    const container = childrenRef.current
    const childMids: number[] = []
    for (let i = 0; i < container.children.length; i++) {
      const el = container.children[i] as HTMLElement
      const pill = el.querySelector('[data-pill]') as HTMLElement | null
      const h = pill?.offsetHeight ?? 24
      childMids.push(el.offsetTop + h / 2)
    }
    setCurves({ parentMid, childMids })
  }, [totalSlots, node.children, expanded])

  const handleClick = () => {
    if (node.type === 'dir' && hasChildren) {
      onToggleCollapse(`changed:${node.path}`)
      onLayoutChange()
    } else if (node.type === 'file') {
      onSelectFileByPath(node.path)
    }
  }

  return (
    <div className="flex items-start">
      <div
        ref={pillRef}
        onMouseEnter={() => onHover(node.path)}
        onClick={handleClick}
        style={{ cursor: node.type === 'file' ? 'pointer' : hasChildren ? 'pointer' : 'default' }}
      >
        <MemoryMindPill
          node={node}
          isHovered={isHovered}
          isOnPath={isOnHoverPath}
          isExpanded={expanded}
          isSelected={!!selected}
        />
      </div>
      {totalSlots > 0 && (
        <div style={{ position: 'relative' }}>
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: CURVE_W,
              height: '100%',
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            {curves.childMids.map((cy, i) => (
              <path
                key={i}
                d={bezierD(0, curves.parentMid, CURVE_W, cy)}
                fill="none"
                stroke="var(--c-curve-lo)"
                strokeWidth={1}
              />
            ))}
          </svg>
          <div
            ref={childrenRef}
            className="flex flex-col"
            style={{ gap: CHILD_GAP, paddingLeft: CURVE_W }}
          >
            {expanded && node.children!.map(child => (
              <div key={child.path}>
                <MemoryMindBranch
                  node={child}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={onToggleCollapse}
                  hoveredPath={hoveredPath}
                  onHover={onHover}
                  onLayoutChange={onLayoutChange}
                  onSelectFileByPath={onSelectFileByPath}
                  selectedFileId={selectedFileId}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MemoryMindMapFileTree({
  nodes,
  collapsedIds,
  onToggleCollapse,
  onSelectFileByPath,
  selectedFileId,
}: {
  nodes: MemoryTreeNode[]
  collapsedIds: Set<string>
  onToggleCollapse: (id: string) => void
  onSelectFileByPath: (path: string) => void
  selectedFileId: string | null
}) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const compressed = useMemo(() => nodes.map(compressNode), [nodes])
  const [, setLayoutVersion] = useState(0)
  const bumpLayout = () => setLayoutVersion(v => v + 1)
  return (
    <div className="flex flex-col gap-4 overflow-x-auto py-2 pb-3" onMouseLeave={() => setHoveredPath(null)}>
      {compressed.map(node => (
        <MemoryMindBranch
          key={node.path}
          node={node}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          hoveredPath={hoveredPath}
          onHover={setHoveredPath}
          onLayoutChange={bumpLayout}
          onSelectFileByPath={onSelectFileByPath}
          selectedFileId={selectedFileId}
        />
      ))}
    </div>
  )
}

export default function MemoryReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<MemoryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [globalNote, setGlobalNote] = useState('')

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [includedFileIds, setIncludedFileIds] = useState<Set<string>>(new Set())
  const [compressionDecisionMap, setCompressionDecisionMap] = useState<Map<string, CompressionDecision>>(new Map())
  const [modAcceptMap, setModAcceptMap] = useState<Map<string, boolean>>(new Map())
  const [fullFileContent, setFullFileContent] = useState<string>('')
  const [fullFileLoading, setFullFileLoading] = useState(false)

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        const p = data.payload as MemoryPayload
        setPayload(p)
        setLoading(false)
        setIncludedFileIds(new Set(p.defaultIncludedFileIds ?? []))
        setSelectedFileId(p.defaultIncludedFileIds?.[0] ?? p.files?.[0]?.id ?? null)

        const comp = new Map<string, CompressionDecision>()
        for (const rec of p.compressionRecommendations ?? []) comp.set(rec.fileId, rec.recommendation)
        setCompressionDecisionMap(comp)

        const modMap = new Map<string, boolean>()
        for (const mod of p.modifications ?? []) modMap.set(mod.id, true)
        setModAcceptMap(modMap)
      })
      .catch(() => { setFetchError(true); setLoading(false) })
  }, [id])

  const fileMap = useMemo(() => {
    const m = new Map<string, MemoryFile>()
    for (const f of payload?.files ?? []) m.set(f.id, f)
    return m
  }, [payload])

  const selectedFile = selectedFileId ? fileMap.get(selectedFileId) ?? null : null
  const changedFileIds = useMemo(() => new Set((payload?.modifications ?? []).map(m => m.fileId)), [payload])
  const changedFiles = useMemo(
    () => (payload?.files ?? []).filter(f => changedFileIds.has(f.id)),
    [payload, changedFileIds]
  )
  const changedTree = useMemo(
    () => buildMemoryTree(payload?.files ?? [], changedFileIds),
    [payload, changedFileIds]
  )
  const pathToFileId = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of payload?.files ?? []) m.set(f.relativePath, f.id)
    return m
  }, [payload])
  const selectedModification = useMemo(() => {
    if (!selectedFileId || !payload) return null
    return payload.modifications.find(mod => mod.fileId === selectedFileId) ?? null
  }, [payload, selectedFileId])

  const diffLines = useMemo(() => {
    if (!selectedModification) return []
    return computeSimpleDiff(selectedModification.oldContent, selectedModification.newContent)
  }, [selectedModification])

  useEffect(() => {
    if (!selectedFile) {
      setFullFileContent('')
      return
    }
    setFullFileLoading(true)
    fetch(`/api/memory/file?path=${encodeURIComponent(selectedFile.path)}`)
      .then(r => r.json())
      .then(data => setFullFileContent(String(data.content ?? '')))
      .catch(() => setFullFileContent('Failed to load full file content.'))
      .finally(() => setFullFileLoading(false))
  }, [selectedFile?.path])

  const toggleCollapse = (idValue: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(idValue)) next.delete(idValue)
      else next.add(idValue)
      return next
    })
  }

  const toggleInclude = (fileId: string) => {
    setIncludedFileIds(prev => {
      const next = new Set(prev)
      if (next.has(fileId)) next.delete(fileId)
      else next.add(fileId)
      return next
    })
  }

  const submit = async (approved: boolean) => {
    setSubmitting(true)
    const compressionDecisions = Object.fromEntries(Array.from(compressionDecisionMap.entries()))
    const disregardedFileIds = Array.from(compressionDecisionMap.entries())
      .filter(([, decision]) => decision === 'disregard')
      .map(([fileId]) => fileId)
    const modificationReview = Object.fromEntries(Array.from(modAcceptMap.entries()))

    await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approved,
        includedFileIds: Array.from(includedFileIds),
        disregardedFileIds,
        compressionDecisions,
        modificationReview,
        globalNote: globalNote || undefined,
      }),
    })
    setSubmitted(true)
    navigate('/')
  }

  if (fetchError) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-500 text-sm">Unable to load memory review session.</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-zinc-400 dark:text-slate-500">Loading...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-500 text-sm">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-zinc-700 dark:text-slate-200">Submitted.</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto py-8 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Memory Review</p>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">{payload.title}</h1>
        {payload.description && <p className="text-sm text-zinc-500 dark:text-slate-400 mt-1">{payload.description}</p>}

        <div className="mt-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider">Modified Files (Mind Map)</p>
            <span className="text-xs text-zinc-500 dark:text-slate-400">{changedFiles.length} changed</span>
          </div>
          {changedFiles.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1 mb-3">
                {changedFiles.map(file => (
                  <button
                    key={`changed-chip-${file.id}`}
                    onClick={() => setSelectedFileId(file.id)}
                    className={`text-xs font-mono px-2 py-1 rounded border ${
                      selectedFileId === file.id
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-slate-300'
                    }`}
                  >
                    M {file.relativePath}
                  </button>
                ))}
              </div>
              <div className="max-h-64 overflow-y-auto pr-1">
                <MemoryMindMapFileTree
                  nodes={changedTree}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={toggleCollapse}
                  onSelectFileByPath={(relativePath) => {
                    const fileId = pathToFileId.get(relativePath)
                    if (fileId) setSelectedFileId(fileId)
                  }}
                  selectedFileId={selectedFileId}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-slate-400">No modifications found.</p>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-zinc-800 dark:text-slate-200">Memory Mindgraph</p>
              <button
                className="text-xs text-blue-500 hover:text-blue-600"
                onClick={() => setCollapsedIds(new Set())}
              >
                Expand All
              </button>
            </div>
            <div className="space-y-2">
              {payload.groups.map(group => {
                const groupCollapsed = collapsedIds.has(group.id)
                return (
                  <div key={group.id} className="border border-gray-100 dark:border-zinc-800 rounded">
                    <button
                      onClick={() => toggleCollapse(group.id)}
                      className="w-full text-left px-2 py-1.5 text-sm font-medium text-zinc-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                    >
                      <span className="text-xs">{groupCollapsed ? '▸' : '▾'}</span>
                      <span>{group.label}</span>
                      <span className="ml-auto text-xs text-zinc-400 dark:text-slate-500">{group.fileIds.length}</span>
                    </button>

                    {!groupCollapsed && (
                      <div className="px-2 pb-2 space-y-1">
                        {group.fileIds.map(fileId => {
                          const file = fileMap.get(fileId)
                          if (!file) return null
                          const fileNodeId = `${group.id}:${file.id}`
                          const fileCollapsed = collapsedIds.has(fileNodeId)
                          const selected = selectedFileId === file.id
                          return (
                            <div key={fileNodeId} className={`rounded border ${
                              selected
                                ? 'border-blue-300 dark:border-blue-700'
                                : changedFileIds.has(file.id)
                                  ? 'border-amber-200 dark:border-amber-800'
                                  : 'border-gray-100 dark:border-zinc-800'
                            }`}>
                              <div className="flex items-center gap-1 px-2 py-1">
                                <button
                                  onClick={() => toggleCollapse(fileNodeId)}
                                  className="text-xs text-zinc-400 dark:text-slate-500"
                                >
                                  {fileCollapsed ? '▸' : '▾'}
                                </button>
                                <input
                                  type="checkbox"
                                  checked={includedFileIds.has(file.id)}
                                  onChange={() => toggleInclude(file.id)}
                                />
                                <button
                                  onClick={() => setSelectedFileId(file.id)}
                                  className="text-left flex-1 text-xs font-mono text-zinc-700 dark:text-slate-300 truncate"
                                  title={file.path}
                                >
                                  {changedFileIds.has(file.id) ? `M ${file.relativePath}` : file.relativePath}
                                </button>
                              </div>
                              {!fileCollapsed && (
                                <div className="px-7 pb-1 space-y-1">
                                  <div className="flex gap-1 flex-wrap">
                                    {file.categories.map(cat => (
                                      <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-slate-400">{cat}</span>
                                    ))}
                                  </div>
                                  {file.sections.slice(0, 8).map(sec => (
                                    <div key={sec.id} className="text-[11px] text-zinc-500 dark:text-slate-400 truncate"># {sec.title}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            {!selectedFile && (
              <p className="text-sm text-zinc-500 dark:text-slate-400">Select a memory file node to inspect details.</p>
            )}

            {selectedFile && (
              <>
                <div className="mb-3">
                  <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase">Selected File</p>
                  <h2 className="text-sm font-mono text-zinc-800 dark:text-slate-200 break-all">{selectedFile.path}</h2>
                  <p className="text-xs text-zinc-500 dark:text-slate-400 mt-1">
                    {formatBytes(selectedFile.size)} · updated {selectedFile.lastModified ? new Date(selectedFile.lastModified).toLocaleString() : 'unknown'}
                  </p>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase mb-1">Preview</p>
                  <p className="text-sm text-zinc-600 dark:text-slate-300">{selectedFile.preview || 'No preview.'}</p>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase mb-1">Full File</p>
                  {fullFileLoading ? (
                    <p className="text-sm text-zinc-500 dark:text-slate-400">Loading full file...</p>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap break-words p-2 max-h-72 overflow-y-auto border border-gray-200 dark:border-zinc-700 rounded bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-slate-300">{fullFileContent || 'No content.'}</pre>
                  )}
                </div>

                <div className="mb-4">
                  <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase mb-1">Compression Decision</p>
                  <div className="flex gap-3">
                    <label className="text-sm text-zinc-700 dark:text-slate-300">
                      <input
                        className="mr-1"
                        type="radio"
                        checked={(compressionDecisionMap.get(selectedFile.id) ?? 'include') === 'include'}
                        onChange={() => setCompressionDecisionMap(prev => new Map(prev).set(selectedFile.id, 'include'))}
                      />
                      include
                    </label>
                    <label className="text-sm text-zinc-700 dark:text-slate-300">
                      <input
                        className="mr-1"
                        type="radio"
                        checked={(compressionDecisionMap.get(selectedFile.id) ?? 'include') === 'disregard'}
                        onChange={() => setCompressionDecisionMap(prev => new Map(prev).set(selectedFile.id, 'disregard'))}
                      />
                      disregard
                    </label>
                  </div>
                  {payload.compressionRecommendations.find(r => r.fileId === selectedFile.id)?.reason && (
                    <p className="text-xs text-zinc-500 dark:text-slate-400 mt-1">
                      {payload.compressionRecommendations.find(r => r.fileId === selectedFile.id)?.reason}
                    </p>
                  )}
                </div>

                {selectedModification && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase">Memory Modification Review</p>
                      <label className="text-xs text-zinc-600 dark:text-slate-300">
                        <input
                          className="mr-1"
                          type="checkbox"
                          checked={modAcceptMap.get(selectedModification.id) ?? true}
                          onChange={e => setModAcceptMap(prev => new Map(prev).set(selectedModification.id, e.target.checked))}
                        />
                        accept modification
                      </label>
                    </div>
                    <p className="text-xs font-mono text-zinc-500 dark:text-slate-400 mb-1">Target: {selectedModification.location}</p>
                    <div className="p-2 border border-gray-200 dark:border-zinc-700 rounded bg-gray-50 dark:bg-zinc-950 mb-2">
                      <p className="text-[11px] text-zinc-500 dark:text-slate-400 mb-1">New Generated Content</p>
                      <pre className="text-xs whitespace-pre-wrap break-words text-zinc-700 dark:text-slate-300">{selectedModification.generatedContent}</pre>
                    </div>
                    <div className="border border-gray-200 dark:border-zinc-700 rounded overflow-hidden">
                      <div className="px-2 py-1 text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-slate-400">Unified Diff</div>
                      <div className="max-h-80 overflow-y-auto">
                        <table className="w-full text-xs font-mono border-collapse">
                          <tbody>
                            {diffLines.map((line, idx) => (
                              <tr
                                key={`${line.type}-${idx}`}
                                className={
                                  line.type === 'add'
                                    ? 'bg-green-50 dark:bg-green-950'
                                    : line.type === 'remove'
                                      ? 'bg-red-50 dark:bg-red-950'
                                      : ''
                                }
                                style={{
                                  borderLeft: line.type === 'add'
                                    ? '3px solid rgba(34,197,94,.8)'
                                    : line.type === 'remove'
                                      ? '3px solid rgba(239,68,68,.8)'
                                      : '3px solid transparent',
                                }}
                              >
                                <td className="w-8 text-right px-2 py-0.5 text-zinc-400 dark:text-slate-500 select-none">{idx + 1}</td>
                                <td
                                  className={`w-5 px-1 py-0.5 text-center font-bold ${
                                    line.type === 'add'
                                      ? 'text-green-700 dark:text-green-300'
                                      : line.type === 'remove'
                                        ? 'text-red-700 dark:text-red-300'
                                        : 'text-zinc-400 dark:text-slate-500'
                                  }`}
                                >
                                  {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                                </td>
                                <td
                                  className={`px-2 py-0.5 whitespace-pre-wrap break-words ${
                                    line.type === 'add'
                                      ? 'text-green-700 dark:text-green-300'
                                      : line.type === 'remove'
                                        ? 'text-red-700 dark:text-red-300'
                                        : 'text-zinc-600 dark:text-slate-400'
                                  }`}
                                >
                                  {line.text}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Note for agent</label>
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300"
            rows={2}
            value={globalNote}
            onChange={e => setGlobalNote(e.target.value)}
            placeholder="Optional note on memory inclusion or modification."
          />
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="flex-1 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium py-2.5 rounded-lg"
          >
            Approve Memory Review
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className="px-5 text-sm text-red-500 border border-red-200 dark:border-red-800 rounded-lg"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}
