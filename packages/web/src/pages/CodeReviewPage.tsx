import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

interface CodePayload {
  command: string
  cwd: string
  explanation: string
  risk: 'low' | 'medium' | 'high'
  files?: string[]
}

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileTreeNode[]
}

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low: 'bg-green-50 text-green-700 border border-green-200',
    medium: 'bg-amber-50 text-amber-700 border border-amber-200',
    high: 'bg-red-50 text-red-500 border border-red-200',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${styles[risk]}`}>
      {risk} risk
    </span>
  )
}

function buildFileTree(paths: string[]): FileTreeNode[] {
  type MutableNode = {
    name: string
    path: string
    type: 'file' | 'dir'
    children?: Map<string, MutableNode>
  }

  const root = new Map<string, MutableNode>()

  for (const rawPath of paths) {
    const normalized = rawPath.trim().replace(/^\/+/, '')
    if (!normalized) continue
    const parts = normalized.split('/').filter(Boolean)
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLeaf = i === parts.length - 1
      const existing = current.get(part)

      if (!existing) {
        const node: MutableNode = {
          name: part,
          path: currentPath,
          type: isLeaf ? 'file' : 'dir',
          children: isLeaf ? undefined : new Map<string, MutableNode>(),
        }
        current.set(part, node)
      } else if (!isLeaf && existing.type === 'file') {
        existing.type = 'dir'
        existing.children = new Map<string, MutableNode>()
      }

      const next = current.get(part)
      if (!next) break
      if (!isLeaf) {
        if (!next.children) next.children = new Map<string, MutableNode>()
        current = next.children
      }
    }
  }

  const toArray = (nodes: Map<string, MutableNode>): FileTreeNode[] =>
    Array.from(nodes.values())
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(node => ({
        name: node.name,
        path: node.path,
        type: node.type,
        children: node.children ? toArray(node.children) : undefined,
      }))

  return toArray(root)
}

function FileTree({
  nodes,
  level,
  expanded,
  onToggle,
}: {
  nodes: FileTreeNode[]
  level: number
  expanded: Record<string, boolean>
  onToggle: (path: string) => void
}) {
  return (
    <div className={level > 0 ? 'pl-4' : ''}>
      {nodes.map(node => {
        if (node.type === 'file') {
          return (
            <div key={node.path} className="py-1 text-sm text-zinc-600 flex items-center gap-2">
              <span aria-hidden="true">📄</span>
              <span className="break-all">{node.name}</span>
            </div>
          )
        }

        const isExpanded = expanded[node.path] ?? true
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              className="w-full text-left py-1 text-sm text-zinc-700 hover:text-zinc-900 transition-colors flex items-center gap-2"
            >
              <span aria-hidden="true">📁</span>
              <span className="break-all">{node.name}</span>
              <span className="text-xs text-zinc-400">{isExpanded ? '−' : '+'}</span>
            </button>
            {isExpanded && node.children && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                level={level + 1}
                expanded={expanded}
                onToggle={onToggle}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function CodeReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [payload, setPayload] = useState<CodePayload | null>(null)
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as CodePayload)
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  const submit = async (approved: boolean) => {
    setSubmitting(true)
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, note })
    }).then(r => r.json())
    if (result.callbackFailed) setCallbackFailed(true)
    setSubmitted(true)
  }

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-red-400 text-sm">Server not reachable — is AgentClick running?</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-zinc-400">Loading...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-red-400">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-700 font-medium">Done. Your agent is continuing.</p>
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-zinc-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  const fileTree = payload.files && payload.files.length > 0 ? buildFileTree(payload.files) : []
  const toggleDir = (path: string) => {
    setExpandedDirs(current => ({ ...current, [path]: !(current[path] ?? true) }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Code Review</p>
          <h1 className="text-xl font-semibold text-zinc-900 truncate">{payload.command}</h1>
          <div className="mt-2">
            <RiskBadge risk={payload.risk} />
          </div>
        </div>

        {/* Command */}
        <div className="mb-4 p-4 bg-white border border-gray-100 rounded-lg">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Command</p>
          <pre className="bg-zinc-950 text-zinc-100 rounded-lg p-3 text-sm font-mono overflow-x-auto">{payload.command}</pre>
        </div>

        {/* Files */}
        {fileTree.length > 0 && (
          <div className="p-4 bg-white border border-gray-100 rounded-lg mb-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Files</p>
            <FileTree nodes={fileTree} level={0} expanded={expandedDirs} onToggle={toggleDir} />
          </div>
        )}

        {/* Working directory */}
        <div className="mb-4 p-4 bg-white border border-gray-100 rounded-lg">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Working directory</p>
          <p className="text-sm text-zinc-500 font-mono">{payload.cwd}</p>
        </div>

        {/* Explanation */}
        <div className="mb-6 p-4 bg-white border border-gray-100 rounded-lg">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">What this does</p>
          <p className="text-sm text-zinc-700 leading-relaxed">{payload.explanation}</p>
        </div>

        {/* Note */}
        <div className="mb-6">
          <textarea
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            placeholder="Add a note or modified command (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className={`flex-1 bg-zinc-900 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-zinc-700 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Approve
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-5 text-sm text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Reject
          </button>
        </div>

      </div>
    </div>
  )
}
