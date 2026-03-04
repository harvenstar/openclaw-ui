import { useEffect, useMemo, useState } from 'react'

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
}

interface MemoryGroup {
  id: string
  label: string
  fileIds: string[]
}

interface CatalogResponse {
  groups: MemoryGroup[]
  files: MemoryFile[]
}

interface FileContentResponse {
  path: string
  relativePath: string
  content: string
}

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
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [selectedContent, setSelectedContent] = useState<FileContentResponse | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedMindGroups, setCollapsedMindGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [fileLoading, setFileLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')
  const [agentDeleteRequest, setAgentDeleteRequest] = useState('')

  const loadCatalog = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/memory/files')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as CatalogResponse
      setCatalog(data)
      setError('')
    } catch {
      setError('Failed to load memory catalog')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCatalog()
  }, [])

  const fileMap = useMemo(() => {
    const m = new Map<string, MemoryFile>()
    for (const file of catalog?.files ?? []) m.set(file.id, file)
    return m
  }, [catalog])

  const openFile = async (file: MemoryFile) => {
    setSelectedPath(file.path)
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

  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleMindGroup = (id: string) => {
    setCollapsedMindGroups(prev => {
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

  const mindGroups = useMemo(() => {
    const files = catalog?.files ?? []
    return [
      {
        id: 'mind_in_content',
        label: 'In This Content',
        files: files.filter(file => file.inCurrentContent),
        color: 'border-emerald-300 bg-emerald-50 text-emerald-800',
      },
      {
        id: 'mind_in_project',
        label: 'In Project (Not Loaded)',
        files: files.filter(file => !file.inCurrentContent && file.inProject),
        color: 'border-blue-300 bg-blue-50 text-blue-800',
      },
      {
        id: 'mind_in_cache',
        label: 'In Agent Cache (Not Loaded)',
        files: files.filter(file => !file.inCurrentContent && file.inAgentCache),
        color: 'border-amber-300 bg-amber-50 text-amber-800',
      },
      {
        id: 'mind_related',
        label: 'Related Markdown',
        files: files.filter(file => !file.inCurrentContent && !file.inProject && !file.inAgentCache && file.relatedMarkdown),
        color: 'border-zinc-300 bg-zinc-100 text-zinc-700',
      },
    ].filter(group => group.files.length > 0)
  }, [catalog])

  const setInContext = async (targetPath: string, include: boolean) => {
    setActionLoading(true)
    try {
      const response = await fetch(include ? '/api/memory/include' : '/api/memory/exclude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await loadCatalog()
      setError('')
    } catch {
      setError(include ? 'Failed to include file in current content' : 'Failed to exclude file from current content')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteRequest = (targetPath: string) => {
    const confirmed = window.confirm('Delete this memory file permanently?')
    if (!confirmed) return
    const requestText = [
      'Please delete this memory file from disk:',
      targetPath,
      '',
      'Reason: user requested file deletion from Memory Management UI.',
    ].join('\n')
    setAgentDeleteRequest(requestText)
    setError('')
  }

  const copyDeleteRequest = async () => {
    if (!agentDeleteRequest) return
    try {
      await navigator.clipboard.writeText(agentDeleteRequest)
    } catch {
      setError('Failed to copy agent delete request')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto py-8 px-4">
        <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Memory Management</p>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">Memory Management</h1>
        <p className="text-sm text-zinc-500 dark:text-slate-400 mt-1">
          Browse memory-related files and open full content in a readable markdown view.
        </p>

        {loading && <p className="text-sm text-zinc-400 dark:text-slate-500 mt-4">Loading memory catalog...</p>}
        {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

        {!loading && catalog && (
          <>
            <div className="mt-5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 overflow-x-auto">
              <p className="text-sm font-medium text-zinc-800 dark:text-slate-200">Memory Level Mind Map</p>
              <p className="text-xs text-zinc-500 dark:text-slate-400 mt-1">Click any file node to open the full file. Click a level node to fold or unfold.</p>
              <div className="mt-4 min-w-[920px]">
                <div className="flex items-start gap-4">
                  <div className="shrink-0 px-3 py-2 rounded-full border border-violet-300 bg-violet-50 text-violet-800 text-xs font-semibold">
                    Memory
                  </div>
                  <div className="flex-1 space-y-2">
                    {mindGroups.map(group => {
                      const collapsed = collapsedMindGroups.has(group.id)
                      return (
                        <div key={group.id} className="flex items-start gap-2">
                          <button
                            onClick={() => toggleMindGroup(group.id)}
                            className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium ${group.color}`}
                          >
                            {collapsed ? '▸' : '▾'} {group.label} ({group.files.length})
                          </button>
                          {!collapsed && (
                            <div className="flex flex-wrap gap-1.5">
                              {group.files.map(file => {
                                const active = selectedPath === file.path
                                return (
                                  <button
                                    key={file.id}
                                    onClick={() => openFile(file)}
                                    className={`px-2 py-1 rounded-full border text-[11px] font-mono max-w-[380px] truncate ${
                                      active
                                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200'
                                        : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-zinc-700'
                                    }`}
                                    title={file.path}
                                  >
                                    {file.relativePath}
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
                            return (
                              <button
                                key={file.id}
                                onClick={() => openFile(file)}
                                className={`w-full text-left px-2 py-1.5 rounded border ${
                                  active
                                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950'
                                    : 'border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800'
                                }`}
                                title={file.path}
                              >
                                <p className="text-xs font-mono text-zinc-700 dark:text-slate-300 truncate">{file.relativePath}</p>
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
                    <button
                      onClick={() => handleDeleteRequest(selectedContent.path)}
                      className="px-2.5 py-1.5 text-xs rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Request Delete (Agent)
                    </button>
                  </div>
                  {agentDeleteRequest && (
                    <div className="mt-3 p-3 rounded border border-red-200 bg-red-50">
                      <p className="text-xs font-medium text-red-700">Agent Deletion Request</p>
                      <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-red-800">{agentDeleteRequest}</pre>
                      <button
                        onClick={copyDeleteRequest}
                        className="mt-2 px-2 py-1 text-xs rounded border border-red-300 text-red-700 bg-white hover:bg-red-100"
                      >
                        Copy Request
                      </button>
                    </div>
                  )}
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
