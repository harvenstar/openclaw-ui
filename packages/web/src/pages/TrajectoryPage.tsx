import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// ─── Error boundary to catch render crashes ───────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('TrajectoryPage crash:', error, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, color: 'red' }}>
        <h2>Render error</h2>
        <pre>{this.state.error.message}</pre>
        <pre>{this.state.error.stack}</pre>
      </div>
    )
    return this.props.children
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrajectoryStep {
  id: string
  type: 'tool_call' | 'decision' | 'observation' | 'error' | 'retry' | 'agent_call' | 'terminal'
  label: string
  detail?: string
  status: 'success' | 'failure' | 'pending' | 'skipped'
  timestamp?: number
  duration?: number
  error?: { message: string; code?: string; stackTrace?: string }
  children?: TrajectoryStep[]
  parallel?: boolean
  agent?: { name: string; model?: string }
  terminal?: { command?: string; exitCode?: number; output?: string }
}

interface TrajectoryPayload {
  title: string
  description?: string
  steps: TrajectoryStep[]
  context?: Record<string, string>
}

interface StepRevision {
  stepId: string
  action: 'mark_wrong' | 'provide_guidance' | 'skip'
  correction?: string
  guidance?: string
  shouldLearn?: boolean
}

// ─── Step type badge ──────────────────────────────────────────────────────────

const STEP_TYPE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  tool_call:   { bg: 'var(--c-step-tool-bg)',        border: 'var(--c-step-tool-border)',        text: 'var(--c-step-tool-text)' },
  decision:    { bg: 'var(--c-step-decision-bg)',     border: 'var(--c-step-decision-border)',     text: 'var(--c-step-decision-text)' },
  observation: { bg: 'var(--c-step-observation-bg)',  border: 'var(--c-step-observation-border)',  text: 'var(--c-step-observation-text)' },
  error:       { bg: 'var(--c-step-error-bg)',        border: 'var(--c-step-error-border)',        text: 'var(--c-step-error-text)' },
  retry:       { bg: 'var(--c-step-retry-bg)',        border: 'var(--c-step-retry-border)',        text: 'var(--c-step-retry-text)' },
  agent_call:  { bg: 'var(--c-step-agent-bg)',       border: 'var(--c-step-agent-border)',       text: 'var(--c-step-agent-text)' },
  terminal:    { bg: 'var(--c-step-terminal-bg)',    border: 'var(--c-step-terminal-border)',    text: 'var(--c-step-terminal-text)' },
}

const STEP_TYPE_ICONS: Record<string, string> = {
  agent_call: '\u2B21',  // hexagon — sub-agent
  terminal:   '\u25B8',  // triangle right — terminal/shell
}

function StepTypeBadge({ type }: { type: string }) {
  const s = STEP_TYPE_STYLES[type] ?? STEP_TYPE_STYLES.observation
  const icon = STEP_TYPE_ICONS[type]
  return (
    <span
      className="inline-block text-xs font-medium px-2 py-0.5 rounded"
      style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.text }}
    >
      {icon ? `${icon} ` : ''}{type.replace('_', ' ')}
    </span>
  )
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: TrajectoryStep['status'] }) {
  const map: Record<string, { symbol: string; color: string }> = {
    success: { symbol: '\u25CF', color: '#22C55E' },
    failure: { symbol: '\u2716', color: 'var(--c-red)' },
    pending: { symbol: '\u25CB', color: 'var(--c-text-muted)' },
    skipped: { symbol: '\u25CC', color: 'var(--c-text-subtle)' },
  }
  const { symbol, color } = map[status] ?? map.pending
  return <span className="text-sm font-bold" style={{ color }}>{symbol}</span>
}

function StatusBadge({ status }: { status: TrajectoryStep['status'] }) {
  const styles: Record<string, string> = {
    success: 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-500',
    failure: 'bg-red-50 dark:bg-red-950 text-red-500 dark:text-red-400',
    pending: 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
    skipped: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded uppercase ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  )
}

// ─── Error panel ──────────────────────────────────────────────────────────────

function ErrorPanel({ err }: { err: NonNullable<TrajectoryStep['error']> }) {
  const [showTrace, setShowTrace] = useState(false)
  return (
    <div
      className="mt-2 rounded-lg border p-3 text-sm"
      style={{ backgroundColor: 'var(--c-diff-remove)', borderColor: 'var(--c-diff-remove-border)' }}
    >
      <p className="font-medium" style={{ color: 'var(--c-step-error-text)' }}>
        {err.code ? `[${err.code}] ` : ''}{err.message}
      </p>
      {err.stackTrace && (
        <>
          <button
            onClick={() => setShowTrace(t => !t)}
            className="text-xs mt-1 hover:underline"
            style={{ color: 'var(--c-text-muted)' }}
          >
            {showTrace ? '\u25BE Hide stack trace' : '\u25B8 Show stack trace'}
          </button>
          {showTrace && (
            <pre className="mt-1 text-xs font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--c-text-muted)' }}>
              {err.stackTrace}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

// ─── Step revision inline form ────────────────────────────────────────────────

function StepRevisionForm({
  revision,
  onSave,
  onCancel,
}: {
  revision: StepRevision
  onSave: (rev: StepRevision) => void
  onCancel: () => void
}) {
  const [correction, setCorrection] = useState(revision.correction ?? '')
  const [guidance, setGuidance] = useState(revision.guidance ?? '')
  const [shouldLearn, setShouldLearn] = useState(revision.shouldLearn ?? false)
  const isWrong = revision.action === 'mark_wrong'

  return (
    <div className="mt-2 p-3 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg space-y-2">
      {isWrong && (
        <div>
          <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">What went wrong?</label>
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            placeholder="Describe what was incorrect..."
            value={correction}
            onChange={e => setCorrection(e.target.value)}
          />
        </div>
      )}
      <div>
        <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">What should the agent do instead?</label>
        <textarea
          className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={2}
          placeholder="Provide guidance for future runs..."
          value={guidance}
          onChange={e => setGuidance(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`learn-${revision.stepId}`}
          checked={shouldLearn}
          onChange={e => setShouldLearn(e.target.checked)}
          className="rounded border-gray-300 dark:border-zinc-600"
        />
        <label htmlFor={`learn-${revision.stepId}`} className="text-xs text-zinc-500 dark:text-slate-400">
          Remember this for future runs
        </label>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ ...revision, correction, guidance, shouldLearn })}
          className="text-xs px-3 py-1.5 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded hover:bg-zinc-700 dark:hover:bg-slate-200 transition-colors font-medium"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 text-zinc-500 dark:text-slate-400 border border-gray-200 dark:border-zinc-700 rounded hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── DAG layout engine ────────────────────────────────────────────────────────

const NODE_W = 200
const NODE_H = 56
const GAP_X = 32
const GAP_Y = 28

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

interface LayoutNode {
  stepId: string
  row: number
  col: number
  parentId: string | null
  step: TrajectoryStep
}

interface LayoutEdge {
  fromId: string
  toId: string
  isFailureRetry?: boolean
}

interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  cols: number
  rows: number
}

function computeLayout(steps: TrajectoryStep[], collapsedIds: Set<string>): LayoutResult {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  let maxCol = 0
  let maxRow = 0

  function walkChildren(
    children: TrajectoryStep[],
    parentId: string | null,
    startRow: number,
  ): number {
    let row = startRow

    let i = 0
    while (i < children.length) {
      const step = children[i]

      // Collect parallel band: current step + consecutive parallel siblings
      const band: TrajectoryStep[] = [step]
      while (i + 1 < children.length && children[i + 1].parallel) {
        band.push(children[++i])
      }

      if (band.length === 1) {
        // Sequential step — single column centered (col 0)
        const s = band[0]
        nodes.push({ stepId: s.id, row, col: 0, parentId, step: s })
        if (parentId) {
          const parentStep = nodes.find(n => n.stepId === parentId)?.step
          const isFailureRetry = parentStep?.status === 'failure' && s.type === 'retry'
          edges.push({ fromId: parentId, toId: s.id, isFailureRetry })
        }
        if (maxRow < row) maxRow = row

        // Process children if not collapsed
        if (s.children && s.children.length > 0 && !collapsedIds.has(s.id)) {
          row = walkChildren(s.children, s.id, row + 1)
        } else {
          row++
        }
      } else {
        // Parallel band — spread across columns
        const bandStartCol = 0
        let bandMaxRow = row

        for (let b = 0; b < band.length; b++) {
          const s = band[b]
          const col = bandStartCol + b
          if (col > maxCol) maxCol = col
          nodes.push({ stepId: s.id, row, col, parentId, step: s })
          if (parentId) {
            const parentStep = nodes.find(n => n.stepId === parentId)?.step
            const isFailureRetry = parentStep?.status === 'failure' && s.type === 'retry'
            edges.push({ fromId: parentId, toId: s.id, isFailureRetry })
          }

          // Process children of each parallel step
          if (s.children && s.children.length > 0 && !collapsedIds.has(s.id)) {
            const childEndRow = walkChildren(s.children, s.id, row + 1)
            if (childEndRow > bandMaxRow) bandMaxRow = childEndRow
          }
        }

        if (row > maxRow) maxRow = row
        row = bandMaxRow > row ? bandMaxRow : row + 1
      }

      i++
    }

    return row
  }

  walkChildren(steps, null, 0)

  return {
    nodes,
    edges,
    cols: maxCol + 1,
    rows: maxRow + 1,
  }
}

// ─── Build a step lookup from the step tree ───────────────────────────────────

function buildStepMap(steps: TrajectoryStep[]): Map<string, TrajectoryStep> {
  const map = new Map<string, TrajectoryStep>()
  function walk(list: TrajectoryStep[]) {
    for (const s of list) {
      map.set(s.id, s)
      if (s.children) walk(s.children)
    }
  }
  walk(steps)
  return map
}

// ─── Hover trace: ancestors + descendants ─────────────────────────────────────

function computeConnectedSet(nodeId: string, edges: LayoutEdge[]): Set<string> {
  const connected = new Set<string>()
  connected.add(nodeId)

  // Walk ancestors
  const parentMap = new Map<string, string[]>()
  const childMap = new Map<string, string[]>()
  for (const e of edges) {
    if (!parentMap.has(e.toId)) parentMap.set(e.toId, [])
    parentMap.get(e.toId)!.push(e.fromId)
    if (!childMap.has(e.fromId)) childMap.set(e.fromId, [])
    childMap.get(e.fromId)!.push(e.toId)
  }

  const queue = [nodeId]
  // ancestors
  const visited = new Set<string>([nodeId])
  while (queue.length) {
    const cur = queue.pop()!
    for (const p of parentMap.get(cur) ?? []) {
      if (!visited.has(p)) { visited.add(p); connected.add(p); queue.push(p) }
    }
  }
  // descendants
  const queue2 = [nodeId]
  const visited2 = new Set<string>([nodeId])
  while (queue2.length) {
    const cur = queue2.pop()!
    for (const c of childMap.get(cur) ?? []) {
      if (!visited2.has(c)) { visited2.add(c); connected.add(c); queue2.push(c) }
    }
  }

  return connected
}

// ─── Vertical bezier path ─────────────────────────────────────────────────────

function verticalBezierD(x1: number, y1: number, x2: number, y2: number): string {
  const cy = y1 + (y2 - y1) * 0.55
  return `M ${x1},${y1} C ${x1},${cy} ${x2},${cy} ${x2},${y2}`
}

// ─── DagEdgeLayer ─────────────────────────────────────────────────────────────

function DagEdgeLayer({
  edges,
  nodePositions,
  connectedSet,
  hoveredNodeId,
}: {
  edges: LayoutEdge[]
  nodePositions: Map<string, { x: number; y: number }>
  connectedSet: Set<string>
  hoveredNodeId: string | null
}) {
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {edges.map(e => {
        const from = nodePositions.get(e.fromId)
        const to = nodePositions.get(e.toId)
        if (!from || !to) return null

        // Anchor at the edge of the node closest to the other node
        const fromCx = from.x + NODE_W / 2
        const toCx = to.x + NODE_W / 2
        const x1 = Math.max(from.x, Math.min(from.x + NODE_W, toCx))
        const y1 = from.y + NODE_H
        const x2 = Math.max(to.x, Math.min(to.x + NODE_W, fromCx))
        const y2 = to.y

        const isHighlighted = hoveredNodeId
          ? connectedSet.has(e.fromId) && connectedSet.has(e.toId)
          : false
        const isDimmed = hoveredNodeId && !isHighlighted

        return (
          <path
            key={`${e.fromId}-${e.toId}`}
            d={verticalBezierD(x1, y1, x2, y2)}
            fill="none"
            stroke={
              e.isFailureRetry
                ? 'var(--c-step-error-border)'
                : isHighlighted
                  ? 'var(--c-curve-hi)'
                  : 'var(--c-curve-lo)'
            }
            strokeWidth={isHighlighted ? 2 : 1.5}
            strokeDasharray={e.isFailureRetry ? '6 3' : undefined}
            opacity={isDimmed ? 0.3 : 1}
            style={{ transition: 'stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease' }}
          />
        )
      })}
    </svg>
  )
}

// ─── DagNode ──────────────────────────────────────────────────────────────────

function DagNode({
  node,
  x,
  y,
  isHovered,
  isSelected,
  isDimmed,
  hasChildren,
  isCollapsed,
  revision,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  node: LayoutNode
  x: number
  y: number
  isHovered: boolean
  isSelected: boolean
  isDimmed: boolean
  hasChildren: boolean
  isCollapsed: boolean
  revision?: StepRevision
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
}) {
  const step = node.step
  const isFailure = step.status === 'failure'

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: NODE_W,
        minHeight: NODE_H,
        transform: isHovered ? 'scale(1.03)' : 'scale(1)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.25s ease',
        opacity: isDimmed ? 0.4 : 1,
        zIndex: isHovered ? 10 : 1,
        cursor: 'pointer',
      }}
      className={`rounded-lg border px-3 py-2 ${
        isSelected
          ? 'border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900'
          : 'border-gray-200 dark:border-zinc-700'
      }`}
      data-step-id={node.stepId}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Step ${node.stepId}: ${step.label}`}
    >
      <div
        style={{
          backgroundColor: 'var(--c-surface)',
          boxShadow: isHovered
            ? '0 4px 12px var(--c-dag-node-shadow)'
            : '0 1px 3px var(--c-dag-node-shadow)',
          borderLeft: isFailure
            ? '3px solid var(--c-step-error-border)'
            : step.type === 'agent_call'
              ? '3px solid var(--c-step-agent-border)'
              : step.type === 'terminal'
                ? '3px solid var(--c-step-terminal-border)'
                : undefined,
          borderRadius: 'inherit',
          padding: 'inherit',
          margin: '-0.5rem -0.75rem',
        }}
      >
        {/* Header row */}
        <div className="flex items-center gap-1.5">
          <StatusIcon status={step.status} />
          <span className="text-[10px] font-mono text-zinc-400 dark:text-slate-500">{step.id}</span>
          <StepTypeBadge type={step.type} />
          <span className="flex-1" />
          {revision && (
            <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
              revision.action === 'mark_wrong'
                ? 'bg-red-50 dark:bg-red-950 text-red-500'
                : 'bg-blue-50 dark:bg-blue-950 text-blue-500'
            }`}>
              {revision.action === 'mark_wrong' ? '!' : '\u2139'}
            </span>
          )}
          {step.duration != null && (
            <span className="text-[10px] text-zinc-400 dark:text-slate-500 tabular-nums">{fmtDuration(step.duration)}</span>
          )}
          {hasChildren && (
            <span
              className="text-[9px] opacity-50"
              style={{
                transition: 'transform 0.2s ease',
                display: 'inline-block',
                transform: isCollapsed ? 'none' : 'rotate(90deg)',
              }}
            >
              &#x25B8;
            </span>
          )}
        </div>

        {/* Label */}
        <p className="text-xs text-zinc-700 dark:text-slate-300 mt-1 truncate" title={step.label}>
          {step.label}
        </p>

        {/* Agent/terminal metadata */}
        {step.agent && (
          <p className="text-[10px] text-zinc-400 dark:text-slate-500 mt-0.5 truncate">
            {step.agent.name}{step.agent.model ? ` (${step.agent.model})` : ''}
          </p>
        )}
        {step.terminal?.command && (
          <p className="text-[10px] font-mono text-zinc-400 dark:text-slate-500 mt-0.5 truncate" title={step.terminal.command}>
            $ {step.terminal.command}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── DagNodeDetail (below canvas) ─────────────────────────────────────────────

function DagNodeDetail({
  step,
  revision,
  editingStep,
  onStartEdit,
  onSaveRevision,
  onCancelEdit,
  onClearRevision,
  onClose,
}: {
  step: TrajectoryStep
  revision?: StepRevision
  editingStep: string | null
  onStartEdit: (stepId: string, action: 'mark_wrong' | 'provide_guidance') => void
  onSaveRevision: (rev: StepRevision) => void
  onCancelEdit: () => void
  onClearRevision: (stepId: string) => void
  onClose: () => void
}) {
  const isEditing = editingStep === step.id

  return (
    <div className="mt-4 p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg">
      {/* Close button */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusIcon status={step.status} />
          <span className="text-xs font-mono text-zinc-400 dark:text-slate-500">{step.id}</span>
          <StepTypeBadge type={step.type} />
          <StatusBadge status={step.status} />
          {step.duration != null && (
            <span className="text-xs text-zinc-400 dark:text-slate-500">{step.duration}ms</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-slate-300 text-sm ml-4"
        >
          &times;
        </button>
      </div>

      <p className="text-sm text-zinc-800 dark:text-slate-200 font-medium">{step.label}</p>

      {/* Agent metadata */}
      {step.agent && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--c-step-agent-bg)', border: '1px solid var(--c-step-agent-border)', color: 'var(--c-step-agent-text)' }}>
            {step.agent.name}
          </span>
          {step.agent.model && (
            <span className="text-zinc-400 dark:text-slate-500 font-mono">{step.agent.model}</span>
          )}
        </div>
      )}

      {/* Terminal metadata */}
      {step.terminal && (
        <div className="mt-2 rounded border p-2 font-mono text-xs" style={{ backgroundColor: 'var(--c-step-terminal-bg)', borderColor: 'var(--c-step-terminal-border)' }}>
          {step.terminal.command && (
            <p style={{ color: 'var(--c-step-terminal-text)' }}>$ {step.terminal.command}</p>
          )}
          {step.terminal.exitCode != null && (
            <p className="mt-1" style={{ color: step.terminal.exitCode === 0 ? '#22C55E' : 'var(--c-red)' }}>
              exit code: {step.terminal.exitCode}
            </p>
          )}
          {step.terminal.output && (
            <pre className="mt-1 whitespace-pre-wrap break-all text-zinc-500 dark:text-slate-400">{step.terminal.output}</pre>
          )}
        </div>
      )}

      {/* Detail text */}
      {step.detail && (
        <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all p-2 rounded bg-gray-50 dark:bg-zinc-800 text-zinc-600 dark:text-slate-400 border border-gray-100 dark:border-zinc-700">
          {step.detail}
        </pre>
      )}

      {/* Error */}
      {step.error && <ErrorPanel err={step.error} />}

      {/* Action buttons */}
      {!isEditing && !revision && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onStartEdit(step.id, 'mark_wrong')}
            className="text-xs px-2 py-1 text-red-500 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            Mark Wrong
          </button>
          <button
            onClick={() => onStartEdit(step.id, 'provide_guidance')}
            className="text-xs px-2 py-1 text-blue-500 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
          >
            Add Guidance
          </button>
        </div>
      )}

      {/* Existing revision badge */}
      {revision && !isEditing && (
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
            revision.action === 'mark_wrong'
              ? 'bg-red-50 dark:bg-red-950 text-red-500'
              : 'bg-blue-50 dark:bg-blue-950 text-blue-500'
          }`}>
            {revision.action === 'mark_wrong' ? 'Marked wrong' : 'Guidance added'}
          </span>
          {revision.correction && (
            <span className="text-xs text-zinc-500 dark:text-slate-400 truncate">{revision.correction}</span>
          )}
          {revision.guidance && (
            <span className="text-xs text-zinc-500 dark:text-slate-400 truncate">{revision.guidance}</span>
          )}
          <button
            onClick={() => onClearRevision(step.id)}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-slate-300"
          >
            x
          </button>
        </div>
      )}

      {/* Editing form */}
      {isEditing && revision && (
        <StepRevisionForm
          revision={revision}
          onSave={onSaveRevision}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  )
}

// ─── DagCanvas ────────────────────────────────────────────────────────────────

function DagCanvas({
  layout,
  revisions,
  editingStep,
  onStartEdit,
  onSaveRevision,
  onCancelEdit,
  onClearRevision,
  collapsedIds,
  onToggleCollapse,
  stepMap,
}: {
  layout: LayoutResult
  revisions: Map<string, StepRevision>
  editingStep: string | null
  onStartEdit: (stepId: string, action: 'mark_wrong' | 'provide_guidance') => void
  onSaveRevision: (rev: StepRevision) => void
  onCancelEdit: () => void
  onClearRevision: (stepId: string) => void
  collapsedIds: Set<string>
  onToggleCollapse: (id: string) => void
  stepMap: Map<string, TrajectoryStep>
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // Compute node positions
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    for (const n of layout.nodes) {
      positions.set(n.stepId, {
        x: n.col * (NODE_W + GAP_X),
        y: n.row * (NODE_H + GAP_Y),
      })
    }
    return positions
  }, [layout])

  // Compute connected set for hover highlighting
  const connectedSet = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>()
    return computeConnectedSet(hoveredNodeId, layout.edges)
  }, [hoveredNodeId, layout.edges])

  // Canvas dimensions
  const canvasW = layout.cols * (NODE_W + GAP_X) - GAP_X
  const canvasH = layout.rows * (NODE_H + GAP_Y) - GAP_Y + NODE_H

  const selectedStep = selectedNodeId ? stepMap.get(selectedNodeId) : null

  const handleNodeClick = useCallback((stepId: string, hasChildren: boolean) => {
    if (hasChildren) {
      onToggleCollapse(stepId)
    }
    setSelectedNodeId(prev => prev === stepId ? null : stepId)
  }, [onToggleCollapse])

  return (
    <div>
      {/* Scrollable canvas area */}
      <div
        className="overflow-x-auto rounded-lg border border-gray-100 dark:border-zinc-800"
        style={{ backgroundColor: 'var(--c-dag-bg)' }}
      >
        <div
          style={{
            position: 'relative',
            width: canvasW + 48,
            height: canvasH + 48,
            minWidth: '100%',
          }}
        >
          {/* Center the graph */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 24,
              transform: `translateX(-${canvasW / 2}px)`,
              width: canvasW,
              height: canvasH,
            }}
          >
            {/* Edge layer */}
            <DagEdgeLayer
              edges={layout.edges}
              nodePositions={nodePositions}
              connectedSet={connectedSet}
              hoveredNodeId={hoveredNodeId}
            />

            {/* Node layer */}
            {layout.nodes.map(n => {
              const pos = nodePositions.get(n.stepId)!
              const step = n.step
              const hasChildren = !!(step.children && step.children.length > 0)
              return (
                <DagNode
                  key={n.stepId}
                  node={n}
                  x={pos.x}
                  y={pos.y}
                  isHovered={hoveredNodeId === n.stepId}
                  isSelected={selectedNodeId === n.stepId}
                  isDimmed={!!hoveredNodeId && !connectedSet.has(n.stepId)}
                  hasChildren={hasChildren}
                  isCollapsed={collapsedIds.has(n.stepId)}
                  revision={revisions.get(n.stepId)}
                  onMouseEnter={() => setHoveredNodeId(n.stepId)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={() => handleNodeClick(n.stepId, hasChildren)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedStep && (
        <DagNodeDetail
          step={selectedStep}
          revision={revisions.get(selectedNodeId!)}
          editingStep={editingStep}
          onStartEdit={onStartEdit}
          onSaveRevision={onSaveRevision}
          onCancelEdit={onCancelEdit}
          onClearRevision={onClearRevision}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  )
}

// ─── Collect all step IDs (flattened) ─────────────────────────────────────────

function collectStepIds(steps: TrajectoryStep[]): string[] {
  const ids: string[] = []
  for (const s of steps) {
    ids.push(s.id)
    if (s.children) ids.push(...collectStepIds(s.children))
  }
  return ids
}

// ─── Main page (inner) ───────────────────────────────────────────────────────

function TrajectoryPageInner() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [payload, setPayload] = useState<TrajectoryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)

  // Revision state
  const [revisions, setRevisions] = useState<Map<string, StepRevision>>(new Map())
  const [editingStep, setEditingStep] = useState<string | null>(null)
  const [globalNote, setGlobalNote] = useState('')
  const [resumeFromStep, setResumeFromStep] = useState('')

  // DAG state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  // Rewrite cycle
  const [sessionStatus, setSessionStatus] = useState<string>('pending')
  const statusRef = useRef(sessionStatus)
  statusRef.current = sessionStatus

  // Initial fetch
  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as TrajectoryPayload)
        setSessionStatus(data.status)
        setLoading(false)
      })
      .catch(() => { setFetchError(true); setLoading(false) })
  }, [id])

  // Poll for rewrite cycle updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (statusRef.current !== 'rewriting') return
      fetch(`/api/sessions/${id}`)
        .then(r => r.json())
        .then(data => {
          const newStatus = data.status as string
          if (newStatus === 'pending') {
            setPayload(data.payload as TrajectoryPayload)
            setRevisions(new Map())
            setEditingStep(null)
            setGlobalNote('')
            setResumeFromStep('')
            setCollapsedIds(new Set())
          }
          setSessionStatus(newStatus)
        })
        .catch(() => {})
    }, 2000)

    return () => clearInterval(interval)
  }, [id])

  const allStepIds = payload ? collectStepIds(payload.steps) : []

  // Step lookup map
  const stepMap = useMemo(() => {
    return payload ? buildStepMap(payload.steps) : new Map<string, TrajectoryStep>()
  }, [payload])

  // DAG layout
  const layout = useMemo(() => {
    if (!payload) return { nodes: [], edges: [], cols: 0, rows: 0 }
    return computeLayout(payload.steps, collapsedIds)
  }, [payload, collapsedIds])

  const startEdit = (stepId: string, action: 'mark_wrong' | 'provide_guidance') => {
    const existing = revisions.get(stepId)
    setRevisions(new Map(revisions).set(stepId, existing ?? { stepId, action }))
    setEditingStep(stepId)
  }

  const saveRevision = (rev: StepRevision) => {
    setRevisions(new Map(revisions).set(rev.stepId, rev))
    setEditingStep(null)
  }

  const cancelEdit = () => {
    if (editingStep) {
      const existing = revisions.get(editingStep)
      if (existing && !existing.correction && !existing.guidance) {
        const next = new Map(revisions)
        next.delete(editingStep)
        setRevisions(next)
      }
    }
    setEditingStep(null)
  }

  const clearRevision = (stepId: string) => {
    const next = new Map(revisions)
    next.delete(stepId)
    setRevisions(next)
  }

  const toggleCollapse = useCallback((stepId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }, [])

  const submit = async (approved: boolean) => {
    setSubmitting(true)
    const body = {
      approved,
      revisions: Array.from(revisions.values()).filter(r => r.action !== 'skip'),
      globalNote: globalNote || undefined,
      resumeFromStep: resumeFromStep || undefined,
    }
    const result = await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())

    if (result.callbackFailed) {
      setCallbackFailed(true)
      setSubmitted(true)
      setTimeout(() => navigate('/'), 1500)
    } else {
      setSubmitted(true)
      navigate('/')
    }
  }

  const requestRetry = async () => {
    setSubmitting(true)
    const body = {
      regenerate: true,
      approved: false,
      revisions: Array.from(revisions.values()).filter(r => r.action !== 'skip'),
      globalNote: globalNote || undefined,
      resumeFromStep: resumeFromStep || undefined,
    }
    await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSessionStatus('rewriting')
    setSubmitting(false)
  }

  const stopMonitoring = async () => {
    await fetch(`/api/sessions/${id}/page-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'hidden', stopMonitoring: true, reason: 'user_stopped' }),
    })
    navigate('/')
  }

  // ─── Render states ──────────────────────────────────────────────────────────

  if (fetchError) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-400 text-sm">Server not reachable — is AgentClick running?</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-zinc-400 dark:text-slate-500">Loading...</p>
    </div>
  )

  if (!payload) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <p className="text-red-400">Session not found.</p>
    </div>
  )

  if (submitted) return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-700 dark:text-slate-200 font-medium">Done. Your agent is continuing.</p>
        {callbackFailed && (
          <p className="text-amber-500 text-xs mt-2">Note: agent may not have received the callback.</p>
        )}
        <p className="text-zinc-400 dark:text-slate-500 text-sm mt-1">You can close this tab.</p>
      </div>
    </div>
  )

  if (sessionStatus === 'rewriting') return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-zinc-700 dark:text-slate-200 font-medium">Agent is retrying...</p>
        <p className="text-zinc-400 dark:text-slate-500 text-sm mt-1">Waiting for updated trajectory.</p>
      </div>
    </div>
  )

  // ─── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-full mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Trajectory Review</p>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-slate-100">{payload.title}</h1>
          {payload.description && (
            <p className="text-sm text-zinc-500 dark:text-slate-400 mt-1">{payload.description}</p>
          )}
          {payload.context && Object.keys(payload.context).length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {Object.entries(payload.context).map(([k, v]) => (
                <span key={k} className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* DAG */}
        <div className="mb-6">
          <DagCanvas
            layout={layout}
            revisions={revisions}
            editingStep={editingStep}
            onStartEdit={startEdit}
            onSaveRevision={saveRevision}
            onCancelEdit={cancelEdit}
            onClearRevision={clearRevision}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapse}
            stepMap={stepMap}
          />
        </div>

        {/* Global note */}
        <div className="mb-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Global note</label>
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-700 dark:text-slate-300 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={2}
            placeholder="Add a note for the agent (optional)"
            value={globalNote}
            onChange={e => setGlobalNote(e.target.value)}
          />
        </div>

        {/* Resume from step */}
        {allStepIds.length > 0 && (
          <div className="mb-6">
            <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Resume from step</label>
            <select
              className="text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-zinc-700 dark:text-slate-300 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={resumeFromStep}
              onChange={e => setResumeFromStep(e.target.value)}
            >
              <option value="">(from beginning)</option>
              {allStepIds.map(sid => (
                <option key={sid} value={sid}>{sid}</option>
              ))}
            </select>
          </div>
        )}

        {/* Revision summary */}
        {revisions.size > 0 && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {revisions.size} step revision{revisions.size !== 1 ? 's' : ''} pending
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className={`flex-1 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium py-2.5 rounded-lg hover:bg-zinc-700 dark:hover:bg-slate-200 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Approve
          </button>
          <button
            onClick={requestRetry}
            disabled={submitting}
            className={`px-5 text-sm text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Request Retry
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-5 text-sm text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Reject
          </button>
          <button
            onClick={stopMonitoring}
            disabled={submitting}
            className={`px-5 text-sm text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Stop Monitoring
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Exported page with error boundary ────────────────────────────────────────

export default function TrajectoryPage() {
  return (
    <ErrorBoundary>
      <TrajectoryPageInner />
    </ErrorBoundary>
  )
}
