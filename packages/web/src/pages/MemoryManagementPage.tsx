import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { buildMemoryTree, MemoryMindMapFileTree } from '../components/MemoryMindMapTree'

interface MemoryFile {
  id: string
  path: string
  relativePath: string
  categories: string[]
  preview: string
  inCurrentContent: boolean
  inProject: boolean
  inAgentCache: boolean
  relatedMarkdown: boolean
  guidance?: string
}

interface MemoryGroup {
  id: string
  label: string
  fileIds: string[]
}

interface CatalogResponse {
  groups: MemoryGroup[]
  files: MemoryFile[]
  modifications?: MemoryModification[]
}

interface FileContentResponse {
  path: string
  relativePath: string
  content: string
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

function computeSimpleDiff(oldText: string, newText: string): Array<{ type: 'context' | 'add' | 'remove'; text: string }> {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const out: Array<{ type: 'context' | 'add' | 'remove'; text: string }> = []
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      out.push({ type: 'context', text: oldLines[i] })
      i += 1; j += 1
      continue
    }
    if (i < oldLines.length) { out.push({ type: 'remove', text: oldLines[i] ?? '' }); i += 1 }
    if (j < newLines.length) { out.push({ type: 'add', text: newLines[j] ?? '' }); j += 1 }
  }
  return out
}

type PageStatusState = 'opened' | 'active' | 'hidden'

function renderMarkdownFriendly(markdown: string) {
  const lines = markdown.split('\n')
  const out: JSX.Element[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i])
        i += 1
      }
      out.push(
        <pre key={`code-${key++}`} className="my-3 p-3 rounded bg-zinc-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 overflow-x-auto text-xs font-mono text-zinc-700 dark:text-slate-300">
          <code>{code.join('\n')}</code>
        </pre>
      )
      i += 1
      continue
    }

    if (line.startsWith('### ')) {
      out.push(<h3 key={`h3-${key++}`} className="text-base font-semibold mt-4 mb-1 text-zinc-900 dark:text-slate-100">{line.slice(4)}</h3>)
      i += 1
      continue
    }
    if (line.startsWith('## ')) {
      out.push(<h2 key={`h2-${key++}`} className="text-lg font-semibold mt-5 mb-1 text-zinc-900 dark:text-slate-100">{line.slice(3)}</h2>)
      i += 1
      continue
    }
    if (line.startsWith('# ')) {
      out.push(<h1 key={`h1-${key++}`} className="text-xl font-semibold mt-6 mb-2 text-zinc-900 dark:text-slate-100">{line.slice(2)}</h1>)
      i += 1
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2))
        i += 1
      }
      out.push(
        <ul key={`ul-${key++}`} className="list-disc ml-5 my-2 space-y-1 text-sm text-zinc-700 dark:text-slate-300">
          {items.map((item, idx) => <li key={`li-${idx}`}>{item}</li>)}
        </ul>
      )
      continue
    }

    if (!line.trim()) {
      i += 1
      continue
    }

    out.push(<p key={`p-${key++}`} className="text-sm leading-7 text-zinc-700 dark:text-slate-300 my-2">{line}</p>)
    i += 1
  }
  return out
}

export default function MemoryManagementPage() {
  const { id: sessionId } = useParams<{ id: string }>()
  const isSessionMode = !!sessionId

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [selectedContent, setSelectedContent] = useState<FileContentResponse | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedTreeIds, setCollapsedTreeIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [fileLoading, setFileLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [agentDeleteRequest, setAgentDeleteRequest] = useState('')
  const [waitingForRewrite, setWaitingForRewrite] = useState(false)
  const [fileGuidance, setFileGuidance] = useState<string>('')
  const [guidanceSaving, setGuidanceSaving] = useState(false)
  const pollRef = useRef<number | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    try {
      if (isSessionMode) {
        const response = await fetch(`/api/sessions/${sessionId}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        setCatalog(data.payload as CatalogResponse)
      } else {
        const response = await fetch('/api/memory/files')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as CatalogResponse
        setCatalog(data)
      }
      setError('')
    } catch {
      setError('Failed to load memory catalog')
    } finally {
      setLoading(false)
    }
  }, [isSessionMode, sessionId])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  // Session mode: page status heartbeat
  useEffect(() => {
    if (!isSessionMode) return
    const postPageStatus = async (state: PageStatusState) => {
      try {
        await fetch(`/api/sessions/${sessionId}/page-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state }),
        })
      } catch {
        // Presence tracking is observational only.
      }
    }
    void postPageStatus('opened')
    const activeTimer = window.setInterval(() => {
      void postPageStatus(document.visibilityState === 'visible' ? 'active' : 'hidden')
    }, 10000)
    const onVisibility = () => { void postPageStatus(document.visibilityState === 'visible' ? 'active' : 'hidden') }
    const onBeforeUnload = () => { void postPageStatus('hidden') }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.clearInterval(activeTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [isSessionMode, sessionId])

  // Session mode: poll for payload updates after completing an action
  useEffect(() => {
    if (!waitingForRewrite || !isSessionMode) return
    const poll = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`)
        if (!response.ok) return
        const data = await response.json()
        if (data.status === 'pending') {
          setCatalog(data.payload as CatalogResponse)
          setWaitingForRewrite(false)
        }
      } catch {
        // ignore
      }
    }
    pollRef.current = window.setInterval(poll, 1500)
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current)
    }
  }, [waitingForRewrite, isSessionMode, sessionId])

  const fileMap = useMemo(() => {
    const m = new Map<string, MemoryFile>()
    for (const file of catalog?.files ?? []) m.set(file.id, file)
    return m
  }, [catalog])

  const modificationByFileId = useMemo(() => {
    const m = new Map<string, MemoryModification>()
    for (const mod of catalog?.modifications ?? []) m.set(mod.fileId, mod)
    return m
  }, [catalog])

  const changedFileIds = useMemo(() => new Set(Array.from(modificationByFileId.keys())), [modificationByFileId])

  const selectedFileId = useMemo(() => {
    if (!selectedPath) return null
    const file = catalog?.files.find(f => f.path === selectedPath)
    return file?.id ?? null
  }, [catalog, selectedPath])

  const selectedModification = useMemo(() => {
    if (!selectedFileId) return null
    return modificationByFileId.get(selectedFileId) ?? null
  }, [selectedFileId, modificationByFileId])

  const diffLines = useMemo(() => {
    if (!selectedModification) return []
    return computeSimpleDiff(selectedModification.oldContent, selectedModification.newContent)
  }, [selectedModification])

  const openFile = async (file: MemoryFile) => {
    setSelectedPath(file.path)
    setFileGuidance(file.guidance ?? '')
    setAgentDeleteRequest('')
    setFileLoading(true)
    try {
      const response = await fetch(`/api/memory/file?path=${encodeURIComponent(file.path)}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as FileContentResponse
      setSelectedContent(data)
      setError('')
    } catch {
      setError('Failed to load selected file content')
    } finally {
      setFileLoading(false)
    }
  }

  const saveGuidance = async (filePath: string, value: string) => {
    setGuidanceSaving(true)
    try {
      await fetch('/api/memory/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, guidance: value }),
      })
    } finally {
      setGuidanceSaving(false)
    }
  }

  const openFileByPath = (relPath: string) => {
    const file = catalog?.files.find(f =>
      f.relativePath === relPath ||
      f.relativePath === `/${relPath}` ||
      f.relativePath === relPath.replace(/^\//, '')
    )
    if (file) openFile(file)
  }

  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTreeCollapse = (id: string) => {
    setCollapsedTreeIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedFile = useMemo(() => {
    if (!selectedPath) return null
    return catalog?.files.find(file => file.path === selectedPath) ?? null
  }, [catalog, selectedPath])

  // Build mind map groups with tree nodes
  const mindGroups = useMemo(() => {
    const files = catalog?.files ?? []
    return [
      {
        id: 'mind_in_content',
        label: 'In This Content',
        files: files.filter(file => file.inCurrentContent),
      },
      {
        id: 'mind_in_project',
        label: 'In Project (Not Loaded)',
        files: files.filter(file => !file.inCurrentContent && file.inProject),
      },
      {
        id: 'mind_in_cache',
        label: 'In Agent Cache',
        files: files.filter(file => !file.inCurrentContent && file.inAgentCache),
      },
      {
        id: 'mind_related',
        label: 'Related Markdown',
        files: files.filter(file => !file.inCurrentContent && !file.inProject && !file.inAgentCache && file.relatedMarkdown),
      },
    ].filter(group => group.files.length > 0)
  }, [catalog])

  // Agent Cache collapsed by default
  const [mindGroupCollapseInit, setMindGroupCollapseInit] = useState(false)
  const [collapsedMindGroups, setCollapsedMindGroups] = useState<Set<string>>(new Set(['mind_in_cache']))
  useEffect(() => {
    if (mindGroupCollapseInit || mindGroups.length === 0) return
    setCollapsedMindGroups(new Set(['mind_in_cache']))
    setMindGroupCollapseInit(true)
  }, [mindGroups, mindGroupCollapseInit])

  const toggleMindGroup = (id: string) => {
    setCollapsedMindGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const completeSessionAction = async (action: 'include' | 'exclude' | 'delete', targetPath: string) => {
    if (!isSessionMode) return
    try {
      await fetch(`/api/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true, action, path: targetPath }),
      })
      setWaitingForRewrite(true)
    } catch {
      // ignore session notification failure
    }
  }

  const setInContext = async (targetPath: string, include: boolean) => {
    setActionLoading(true)
    try {
      const response = await fetch(include ? '/api/memory/include' : '/api/memory/exclude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (isSessionMode) {
        await completeSessionAction(include ? 'include' : 'exclude', targetPath)
      }
      await loadCatalog()
      setError('')
    } catch {
      setError(include ? 'Failed to include file in current content' : 'Failed to exclude file from current content')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async (targetPath: string) => {
    const confirmed = window.confirm('Delete this memory file permanently?')
    if (!confirmed) return
    setActionLoading(true)
    if (isSessionMode) {
      await completeSessionAction('delete', targetPath)
      setAgentDeleteRequest(`Deleting ${targetPath}... agent will handle this.`)
    } else {
      setAgentDeleteRequest('Delete requires a session-based management page. Use POST /api/memory/management/create to start a session.')
    }
    setError('')
    setActionLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto py-8 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Memory Management</p>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">Memory Management</h1>
        <p className="text-sm text-zinc-500 dark:text-slate-400 mt-1">
          Browse memory-related files and open full content in a readable markdown view.
        </p>
        {isSessionMode && waitingForRewrite && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Agent is processing your action...</p>
        )}

        {loading && <p className="text-sm text-zinc-400 dark:text-slate-500 mt-4">Loading memory catalog...</p>}
        {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

        {!loading && catalog && (
          <>
            <div className="mt-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 overflow-x-auto">
              <p className="text-sm font-medium text-zinc-800 dark:text-slate-200">Memory Level Mind Map</p>
              <p className="text-xs text-zinc-500 dark:text-slate-400 mt-1">Click any file node to open the full file. Click a directory node to fold or unfold.</p>
              <div className="mt-4 space-y-4">
                {mindGroups.map(group => {
                  const collapsed = collapsedMindGroups.has(group.id)
                  const treeNodes = buildMemoryTree(group.files, changedFileIds)
                  return (
                    <div key={group.id}>
                      <button
                        onClick={() => toggleMindGroup(group.id)}
                        className="px-3 py-1.5 rounded-full border text-xs font-medium border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-slate-300 mb-2"
                      >
                        {collapsed ? '▸' : '▾'} {group.label} ({group.files.length})
                      </button>
                      {!collapsed && (
                        <div className="ml-2">
                          <MemoryMindMapFileTree
                            nodes={treeNodes}
                            collapsedIds={collapsedTreeIds}
                            onToggleCollapse={toggleTreeCollapse}
                            onSelectFileByPath={openFileByPath}
                            selectedFileId={selectedFileId}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-3">
              <p className="text-sm font-medium text-zinc-800 dark:text-slate-200 mb-2">Memory Files</p>
              <div className="space-y-2">
                {catalog.groups.map(group => {
                  const collapsed = collapsedGroups.has(group.id)
                  return (
                    <div key={group.id} className="border border-gray-100 dark:border-zinc-800 rounded">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="w-full px-2 py-1.5 text-left text-sm font-medium text-zinc-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                      >
                        <span className="text-xs">{collapsed ? '▸' : '▾'}</span>
                        <span>{group.label}</span>
                        <span className="ml-auto text-xs text-zinc-400 dark:text-slate-500">{group.fileIds.length}</span>
                      </button>
                      {!collapsed && (
                        <div className="px-2 pb-2 space-y-1">
                          {group.fileIds.map(fileId => {
                            const file = fileMap.get(fileId)
                            if (!file) return null
                            const active = selectedPath === file.path
                            const changed = changedFileIds.has(file.id)
                            return (
                              <button
                                key={file.id}
                                onClick={() => openFile(file)}
                                className={`w-full text-left px-2 py-1.5 rounded border ${
                                  active
                                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950'
                                    : changed
                                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 hover:bg-amber-100 dark:hover:bg-amber-900'
                                      : 'border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800'
                                }`}
                                title={file.path}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {changed && <span className="shrink-0 text-[10px] font-bold px-1 py-0.5 rounded bg-amber-200 dark:bg-amber-900 text-amber-700 dark:text-amber-300">M</span>}
                                  <p className={`text-xs font-mono truncate ${changed ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-700 dark:text-slate-300'}`}>{file.relativePath}</p>
                                </div>
                                <p className="text-[11px] text-zinc-500 dark:text-slate-400 mt-0.5 truncate">{file.preview}</p>
                              </button>
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
              {!selectedContent && !fileLoading && (
                <p className="text-sm text-zinc-500 dark:text-slate-400">Click a memory file to view full content.</p>
              )}
              {fileLoading && <p className="text-sm text-zinc-400 dark:text-slate-500">Loading file content...</p>}
              {selectedContent && !fileLoading && (
                <>
                  <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase mb-1">Full File</p>
                  <h2 className="text-sm font-mono text-zinc-800 dark:text-slate-200 break-all">{selectedContent.path}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedFile?.inCurrentContent ? (
                      <button
                        onClick={() => setInContext(selectedContent.path, false)}
                        disabled={actionLoading}
                        className="px-2.5 py-1.5 text-xs rounded border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Remove From Context
                      </button>
                    ) : (
                      <button
                        onClick={() => setInContext(selectedContent.path, true)}
                        disabled={actionLoading}
                        className="px-2.5 py-1.5 text-xs rounded border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Include In Context
                      </button>
                    )}
                    {isSessionMode && (
                      <button
                        onClick={() => handleDelete(selectedContent.path)}
                        disabled={actionLoading}
                        className="px-2.5 py-1.5 text-xs rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Delete File
                      </button>
                    )}
                  </div>
                  {agentDeleteRequest && (
                    <div className="mt-3 p-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950">
                      <p className="text-xs text-amber-700 dark:text-amber-400">{agentDeleteRequest}</p>
                    </div>
                  )}
                  {selectedModification && (
                    <div className="mt-4 mb-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">M</span>
                        <p className="text-xs font-medium text-zinc-700 dark:text-slate-300">Proposed Changes</p>
                      </div>
                      <div className="border border-gray-200 dark:border-zinc-700 rounded overflow-hidden max-h-80 overflow-y-auto mb-4">
                        <table className="w-full text-xs font-mono border-collapse">
                          <tbody>
                            {diffLines.map((line, idx) => (
                              <tr key={idx} className={line.type === 'add' ? 'bg-green-50 dark:bg-green-950' : line.type === 'remove' ? 'bg-red-50 dark:bg-red-950' : ''}>
                                <td className="w-8 text-right px-2 py-0.5 text-zinc-400 dark:text-slate-500 select-none border-r border-gray-100 dark:border-zinc-800"
                                  style={{ borderLeft: line.type === 'add' ? '3px solid rgba(34,197,94,.8)' : line.type === 'remove' ? '3px solid rgba(239,68,68,.8)' : '3px solid transparent' }}>
                                  {idx + 1}
                                </td>
                                <td className="w-5 px-1 py-0.5 text-center font-bold select-none"
                                  style={{ color: line.type === 'add' ? 'rgb(21,128,61)' : line.type === 'remove' ? 'rgb(185,28,28)' : 'transparent' }}>
                                  {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                                </td>
                                <td className={`px-2 py-0.5 whitespace-pre-wrap break-words ${line.type === 'add' ? 'text-green-700 dark:text-green-300' : line.type === 'remove' ? 'text-red-700 dark:text-red-300' : 'text-zinc-600 dark:text-slate-400'}`}>
                                  {line.text}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="mt-4">
                    <label className="text-xs font-medium text-zinc-500 dark:text-slate-400 block mb-1">
                      Update Guidance
                      {guidanceSaving && <span className="ml-2 text-zinc-400 dark:text-slate-500">saving…</span>}
                    </label>
                    <textarea
                      className="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 resize-none"
                      rows={3}
                      placeholder="Describe how this file should be updated (e.g. 'always append new bugs as bullet points under Key Bugs'). Saved as preference."
                      value={fileGuidance}
                      onChange={e => setFileGuidance(e.target.value)}
                      onBlur={e => { if (selectedContent) void saveGuidance(selectedContent.path, e.target.value) }}
                    />
                  </div>
                  <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1">
                    {renderMarkdownFriendly(selectedContent.content)}
                  </div>
                </>
              )}
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
