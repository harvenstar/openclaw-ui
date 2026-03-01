import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AffectedFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  diff?: string       // unified diff string
  oldPath?: string    // for renamed files
}

interface CodePayload {
  command: string
  cwd: string
  explanation: string
  risk: 'low' | 'medium' | 'high'
  files?: string[]            // legacy: plain list
  affectedFiles?: AffectedFile[]
}

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  affected?: AffectedFile     // set if this node is an affected file
  onPath: boolean             // true if this node or a descendant is affected
  children?: FileTreeNode[]
}

// ─── Risk badge ───────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low:    'bg-green-50 text-green-700 border border-green-200',
    medium: 'bg-amber-50 text-amber-700 border border-amber-200',
    high:   'bg-red-50 text-red-500 border border-red-200',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${styles[risk]}`}>
      {risk} risk
    </span>
  )
}

// ─── File status badge ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AffectedFile['status'] }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    modified: { label: 'M', bg: '#EBF4FA', color: '#457B9D' },
    added:    { label: 'A', bg: '#E8F5F0', color: '#2A9D8F' },
    deleted:  { label: 'D', bg: '#FEF0F0', color: '#E63946' },
    renamed:  { label: 'R', bg: '#FFF8EC', color: '#E2A12A' },
  }
  const { label, bg, color } = cfg[status] ?? cfg.modified
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded text-xs font-bold shrink-0"
      style={{ backgroundColor: bg, color }}
      title={status}
    >
      {label}
    </span>
  )
}

// ─── Tree builder ─────────────────────────────────────────────────────────────

function buildFileTree(affectedFiles: AffectedFile[]): FileTreeNode[] {
  type MutableNode = {
    name: string
    path: string
    type: 'file' | 'dir'
    affected?: AffectedFile
    children?: Map<string, MutableNode>
  }

  const root = new Map<string, MutableNode>()

  for (const af of affectedFiles) {
    const parts = af.path.trim().replace(/^\/+/, '').split('/').filter(Boolean)
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLeaf = i === parts.length - 1

      let node = current.get(part)
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLeaf ? 'file' : 'dir',
          affected: isLeaf ? af : undefined,
          children: isLeaf ? undefined : new Map(),
        }
        current.set(part, node)
      }
      if (!isLeaf) {
        if (!node.children) node.children = new Map()
        current = node.children
      }
    }
  }

  const toArray = (nodes: Map<string, MutableNode>): FileTreeNode[] => {
    const result: FileTreeNode[] = []
    for (const node of nodes.values()) {
      const children = node.children ? toArray(node.children) : undefined
      const onPath = !!(node.affected || children?.some(c => c.onPath))
      result.push({
        name: node.name,
        path: node.path,
        type: node.type,
        affected: node.affected,
        onPath,
        children,
      })
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  return toArray(root)
}

// ─── Mind-map file tree ───────────────────────────────────────────────────────

const CURVE_W   = 36   // horizontal width of bezier connector area
const CHILD_GAP = 5    // vertical gap between sibling nodes

// Low-saturation status palette
const STATUS_STYLE: Record<AffectedFile['status'], { bg: string; border: string; text: string; label: string }> = {
  added:    { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803D', label: 'A' },
  modified: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1D4ED8', label: 'M' },
  deleted:  { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', label: 'D' },
  renamed:  { bg: '#FFFBEB', border: '#FDE68A', text: '#A16207', label: 'R' },
}

// Compress single-child-dir chains: src/ → api/ becomes src/api/
function compressNode(node: FileTreeNode): FileTreeNode {
  if (node.type !== 'dir' || !node.children) return node
  const children = node.children.map(compressNode)
  const onPathDirs  = children.filter(c => c.type === 'dir'  && c.onPath)
  const onPathFiles = children.filter(c => c.type === 'file' && c.onPath)
  if (onPathDirs.length === 1 && onPathFiles.length === 0) {
    const only = onPathDirs[0]
    return compressNode({ ...node, name: `${node.name}/${only.name}`, path: only.path, children: only.children })
  }
  return { ...node, children }
}

// Cubic bezier with horizontal tangents
function bezierD(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) * 0.55
  return `M ${x1},${y1} C ${cx},${y1} ${cx},${y2} ${x2},${y2}`
}

function MindMapPill({ node, isHovered, isOnPath }: {
  node: FileTreeNode
  isHovered: boolean
  isOnPath: boolean
}) {
  // Affected file — strongest visual presence
  if (node.type === 'file' && node.affected) {
    const s = STATUS_STYLE[node.affected.status]
    return (
      <div
        data-pill
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold whitespace-nowrap select-none"
        style={{
          backgroundColor: s.bg,
          border: `1.5px solid ${isHovered ? s.text : s.border}`,
          color: s.text,
          boxShadow: isHovered ? '0 1px 6px rgba(0,0,0,0.07)' : 'none',
          transform: isHovered ? 'scale(1.04)' : 'none',
          transition: 'all 0.2s ease',
        }}
      >
        <span className="text-[9px] font-bold opacity-70">{s.label}</span>
        <span>{node.name}</span>
        {node.affected.status === 'renamed' && node.affected.oldPath && (
          <span className="font-normal opacity-50 text-[10px]">← {node.affected.oldPath.split('/').pop()}</span>
        )}
      </div>
    )
  }

  // Directory — light structural node
  if (node.type === 'dir') {
    const active = isOnPath || isHovered
    return (
      <div
        data-pill
        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap select-none"
        style={{
          backgroundColor: active ? '#F1F5F9' : '#FAFAFC',
          border: `1px solid ${active ? '#CBD5E1' : '#F0F1F3'}`,
          color: active ? '#475569' : '#9CA3AF',
          fontWeight: 500,
          transition: 'all 0.2s ease',
        }}
      >
        {node.name}/
      </div>
    )
  }

  // Off-path file — very subtle
  return (
    <div
      data-pill
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono whitespace-nowrap select-none"
      style={{
        backgroundColor: '#FAFAFC',
        border: '1px solid #F0F1F3',
        color: '#9CA3AF',
        transition: 'all 0.2s ease',
      }}
    >
      {node.name}
    </div>
  )
}

function MindMapBranch({ node, depth, hoveredPath, onHover }: {
  node: FileTreeNode
  depth: number
  hoveredPath: string | null
  onHover: (path: string | null) => void
}) {
  const pillRef = useRef<HTMLDivElement>(null)
  const childrenRef = useRef<HTMLDivElement>(null)
  const [curves, setCurves] = useState<{ parentMid: number; childMids: number[] }>({ parentMid: 12, childMids: [] })

  const children = node.children ?? []
  const onPathKids = children.filter(c => c.onPath)
  const offPathKids = children.filter(c => !c.onPath)
  const shown  = [...onPathKids, ...offPathKids.slice(0, 1)]
  const hidden = offPathKids.length - Math.min(offPathKids.length, 1)
  const totalSlots = shown.length + (hidden > 0 ? 1 : 0)

  useLayoutEffect(() => {
    if (!pillRef.current || !childrenRef.current || totalSlots === 0) return
    const parentMid = pillRef.current.offsetHeight / 2
    const container = childrenRef.current
    const childMids: number[] = []
    for (let i = 0; i < container.children.length; i++) {
      const el = container.children[i] as HTMLElement
      const pill = el.querySelector('[data-pill]') as HTMLElement | null
      const h = pill?.offsetHeight ?? 24
      childMids.push(el.offsetTop + h / 2)
    }
    setCurves(prev => {
      if (prev.parentMid === parentMid &&
          prev.childMids.length === childMids.length &&
          prev.childMids.every((m, i) => Math.abs(m - childMids[i]) < 0.5)) {
        return prev
      }
      return { parentMid, childMids }
    })
  })

  const isOnHoverPath = hoveredPath != null && (
    hoveredPath === node.path || hoveredPath.startsWith(node.path + '/')
  )
  const isHovered = hoveredPath === node.path

  const childIsOnHoverPath = (child: FileTreeNode) => hoveredPath != null && (
    hoveredPath === child.path || hoveredPath.startsWith(child.path + '/')
  )

  return (
    <div className="flex items-start">
      <div
        ref={pillRef}
        onMouseEnter={() => onHover(node.path)}
      >
        <MindMapPill node={node} isHovered={isHovered} isOnPath={isOnHoverPath} />
      </div>
      {totalSlots > 0 && (
        <div style={{ position: 'relative' }}>
          {/* SVG bezier curves */}
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
            {curves.childMids.map((cy, i) => {
              const child = shown[i]
              const highlight = child ? childIsOnHoverPath(child) : false
              return (
                <path
                  key={i}
                  d={bezierD(0, curves.parentMid, CURVE_W, cy)}
                  fill="none"
                  stroke={highlight ? '#94A3B8' : '#E5E7EB'}
                  strokeWidth={highlight ? 1.8 : 1}
                  style={{ transition: 'stroke 0.25s ease, stroke-width 0.25s ease' }}
                />
              )
            })}
          </svg>
          {/* Children */}
          <div
            ref={childrenRef}
            className="flex flex-col"
            style={{ gap: CHILD_GAP, paddingLeft: CURVE_W }}
          >
            {shown.map(child => (
              <div key={child.path}>
                <MindMapBranch
                  node={child}
                  depth={depth + 1}
                  hoveredPath={hoveredPath}
                  onHover={onHover}
                />
              </div>
            ))}
            {hidden > 0 && (
              <div data-pill>
                <div
                  className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-mono whitespace-nowrap select-none"
                  style={{ backgroundColor: '#FAFAFC', border: '1px dashed #E5E7EB', color: '#9CA3AF' }}
                >
                  +{hidden} more
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MindMapFileTree({ nodes }: { nodes: FileTreeNode[] }) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const compressed = useMemo(() => nodes.map(compressNode), [nodes])
  return (
    <div
      className="flex flex-col gap-4 overflow-x-auto py-2 pb-3"
      onMouseLeave={() => setHoveredPath(null)}
    >
      {compressed.map(node => (
        <MindMapBranch
          key={node.path}
          node={node}
          depth={0}
          hoveredPath={hoveredPath}
          onHover={setHoveredPath}
        />
      ))}
    </div>
  )
}

// ─── Diff viewer ──────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk'
  content: string
  oldNo?: number
  newNo?: number
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split('\n')
  const result: DiffLine[] = []
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -a,b +c,d @@
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) { oldNo = parseInt(m[1]) - 1; newNo = parseInt(m[2]) - 1 }
      result.push({ type: 'hunk', content: line })
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      newNo++
      result.push({ type: 'added', content: line.slice(1), newNo })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      oldNo++
      result.push({ type: 'removed', content: line.slice(1), oldNo })
    } else if (line.startsWith(' ')) {
      oldNo++; newNo++
      result.push({ type: 'context', content: line.slice(1), oldNo, newNo })
    }
  }
  return result
}

function diffLineStyle(type: DiffLine['type']): React.CSSProperties {
  if (type === 'added')   return { backgroundColor: '#E6F4F1', borderLeft: '3px solid #2A9D8F' }
  if (type === 'removed') return { backgroundColor: '#FEECEE', borderLeft: '3px solid #E63946' }
  if (type === 'hunk')    return { backgroundColor: '#EBF4FA', borderLeft: '3px solid #A8DADC' }
  return {}
}

function diffLineColor(type: DiffLine['type']): string {
  if (type === 'added')   return '#1A6B5E'
  if (type === 'removed') return '#9B2335'
  if (type === 'hunk')    return '#457B9D'
  return '#374151'
}

function diffPrefix(type: DiffLine['type']): string {
  if (type === 'added')   return '+'
  if (type === 'removed') return '−'
  return ' '
}

function DiffViewer({ file }: { file: AffectedFile }) {
  const [collapsed, setCollapsed] = useState(false)
  const diffLines = useMemo(() => file.diff ? parseDiff(file.diff) : [], [file.diff])

  if (!file.diff) return null

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden mb-4">
      {/* File header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <StatusBadge status={file.status} />
          <span className="text-sm font-mono font-medium" style={{ color: '#1D3557' }}>{file.path}</span>
          {file.status === 'renamed' && file.oldPath && (
            <span className="text-xs text-zinc-400">(was {file.oldPath})</span>
          )}
        </div>
        <span className="text-xs text-zinc-400">{collapsed ? '▸ show diff' : '▾ hide diff'}</span>
      </div>

      {/* Diff lines */}
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {diffLines.map((line, i) => (
                <tr key={i} style={diffLineStyle(line.type)}>
                  {/* Old line number */}
                  <td
                    className="text-right px-2 py-0.5 select-none w-10 shrink-0"
                    style={{ color: '#94a3b8', borderRight: '1px solid #E2E8F0', minWidth: '2.5rem' }}
                  >
                    {line.type === 'hunk' ? '' : (line.oldNo ?? '')}
                  </td>
                  {/* New line number */}
                  <td
                    className="text-right px-2 py-0.5 select-none w-10 shrink-0"
                    style={{ color: '#94a3b8', borderRight: '1px solid #E2E8F0', minWidth: '2.5rem' }}
                  >
                    {line.type === 'hunk' ? '' : (line.newNo ?? '')}
                  </td>
                  {/* +/- prefix */}
                  <td
                    className="px-2 py-0.5 select-none w-4 text-center shrink-0"
                    style={{ color: diffLineColor(line.type), fontWeight: line.type !== 'context' ? 700 : 400 }}
                  >
                    {line.type !== 'context' ? diffPrefix(line.type) : ''}
                  </td>
                  {/* Content */}
                  <td
                    className="px-2 py-0.5 whitespace-pre w-full"
                    style={{ color: diffLineColor(line.type) }}
                  >
                    {line.content}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CodeReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<CodePayload | null>(null)
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)

  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => { setPayload(data.payload as CodePayload); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [id])

  // Normalise: prefer affectedFiles, fall back to legacy files[] — must be before early returns (Rules of Hooks)
  const affectedFiles = useMemo<AffectedFile[]>(
    () => payload
      ? (payload.affectedFiles ?? (payload.files ?? []).map(f => ({ path: f, status: 'modified' as const })))
      : [],
    [payload]
  )
  const fileTree = useMemo(() => affectedFiles.length > 0 ? buildFileTree(affectedFiles) : [], [affectedFiles])
  const filesWithDiff = useMemo(() => affectedFiles.filter(f => f.diff), [affectedFiles])

  const submit = async (approved: boolean) => {
    setSubmitting(true)
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, note })
    }).then(r => r.json())
    if (result.callbackFailed) {
      setCallbackFailed(true)
      setSubmitted(true)
      setTimeout(() => navigate('/'), 1500)
    } else {
      navigate('/')
    }
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
        {callbackFailed && <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>}
        <p className="text-zinc-400 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1 font-medium">Code Review</p>
          <div className="flex items-center gap-3 flex-wrap">
            <RiskBadge risk={payload.risk} />
            <span className="text-xs text-zinc-400 font-mono">{payload.cwd}</span>
          </div>
        </div>

        {/* Command */}
        <div className="mb-4 rounded-lg overflow-hidden border border-gray-100">
          <div className="px-3 py-2" style={{ backgroundColor: '#1D3557' }}>
            <p className="text-xs font-medium" style={{ color: '#A8DADC' }}>Command</p>
          </div>
          <pre className="bg-zinc-950 text-zinc-100 px-4 py-3 text-sm font-mono overflow-x-auto leading-relaxed">{payload.command}</pre>
        </div>

        {/* Explanation */}
        <div className="mb-5 p-4 bg-white border border-gray-100 rounded-lg">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1 font-medium">What this does</p>
          <p className="text-sm text-zinc-700 leading-relaxed">{payload.explanation}</p>
        </div>

        {/* Affected files — mind-map */}
        {fileTree.length > 0 && (
          <div className="mb-5 bg-white border border-gray-100 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Affected Files</p>
            </div>
            <div className="px-4 py-4">
              <MindMapFileTree nodes={fileTree} />
            </div>
          </div>
        )}

        {/* Diffs */}
        {filesWithDiff.length > 0 && (
          <div className="mb-5">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-3 font-medium">Changes</p>
            {filesWithDiff.map(f => <DiffViewer key={f.path} file={f} />)}
          </div>
        )}

        {/* Note */}
        <div className="mb-6">
          <textarea
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:border-transparent resize-none"
            style={{ '--tw-ring-color': '#457B9D' } as React.CSSProperties}
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
            className={`flex-1 text-sm font-semibold py-2.5 rounded-lg transition-opacity ${submitting ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
            style={{ backgroundColor: '#2A9D8F', color: '#F1FAEE' }}
          >
            Approve
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-6 text-sm font-semibold py-2.5 rounded-lg transition-opacity ${submitting ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-90'}`}
            style={{ border: '1.5px solid #E63946', color: '#E63946', backgroundColor: 'transparent' }}
          >
            Reject
          </button>
        </div>

      </div>
    </div>
  )
}
