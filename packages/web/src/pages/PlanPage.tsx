import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

// ─── Error boundary ──────────────────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('PlanPage crash:', error, info) }
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

// ─── Types ───────────────────────────────────────────────────────────────────

type PlanStepType = 'action' | 'research' | 'code' | 'terminal' | 'agent_delegate' | 'decision' | 'checkpoint'
type RiskLevel = 'low' | 'medium' | 'high'

interface PlanStep {
  id: string
  type: PlanStepType
  label: string
  description?: string
  risk?: RiskLevel
  estimatedDuration?: string
  optional?: boolean
  files?: string[]
  constraints?: string[]
  children?: PlanStep[]
  parallel?: boolean
}

interface AlternativePlan {
  name: string
  description?: string
  steps: PlanStep[]
}

interface PlanPayload {
  title: string
  description?: string
  steps: PlanStep[]
  context?: Record<string, string>
  alternatives?: AlternativePlan[]
}

interface StepInsertion {
  afterId: string
  step: PlanStep
}

interface StepModification {
  label?: string
  description?: string
  type?: PlanStepType
}

// ─── Plan step type badge ────────────────────────────────────────────────────

const PLAN_TYPE_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  action:          { bg: 'var(--c-plan-action-bg)',     border: 'var(--c-plan-action-border)',     text: 'var(--c-plan-action-text)' },
  research:        { bg: 'var(--c-plan-research-bg)',   border: 'var(--c-plan-research-border)',   text: 'var(--c-plan-research-text)' },
  code:            { bg: 'var(--c-plan-code-bg)',       border: 'var(--c-plan-code-border)',       text: 'var(--c-plan-code-text)' },
  checkpoint:      { bg: 'var(--c-plan-checkpoint-bg)', border: 'var(--c-plan-checkpoint-border)', text: 'var(--c-plan-checkpoint-text)' },
  terminal:        { bg: 'var(--c-step-terminal-bg)',   border: 'var(--c-step-terminal-border)',   text: 'var(--c-step-terminal-text)' },
  agent_delegate:  { bg: 'var(--c-step-agent-bg)',      border: 'var(--c-step-agent-border)',      text: 'var(--c-step-agent-text)' },
  decision:        { bg: 'var(--c-step-decision-bg)',   border: 'var(--c-step-decision-border)',   text: 'var(--c-step-decision-text)' },
}

const PLAN_TYPE_ICONS: Record<string, string> = {
  action:         '\u25B6',  // play
  research:       '\u2315',  // search
  code:           '\u2702',  // code brackets approximation
  terminal:       '\u25B8',  // triangle right
  agent_delegate: '\u2B21',  // hexagon
  decision:       '\u2666',  // diamond
  checkpoint:     '\u2691',  // flag
}

function PlanTypeBadge({ type }: { type: string }) {
  const s = PLAN_TYPE_STYLES[type] ?? PLAN_TYPE_STYLES.action
  const icon = PLAN_TYPE_ICONS[type]
  return (
    <span
      className="inline-block text-xs font-medium px-2 py-0.5 rounded"
      style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, color: s.text }}
    >
      {icon ? `${icon} ` : ''}{type.replace('_', ' ')}
    </span>
  )
}

// ─── Risk badge ──────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const colors: Record<RiskLevel, string> = {
    low: 'var(--c-risk-low)',
    medium: 'var(--c-risk-medium)',
    high: 'var(--c-risk-high)',
  }
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase"
      style={{ border: `1px solid ${colors[risk]}`, color: colors[risk] }}
    >
      {risk}
    </span>
  )
}

// ─── DAG layout engine (same as TrajectoryPage) ──────────────────────────────

const DEFAULT_NODE_W = 420
const MIN_NODE_H = 80
const FOLDED_NODE_H = 120
const MIN_NODE_W = 320
const MAX_NODE_W = 620
const GAP_X = 36
const GAP_Y = 34

interface LayoutNode {
  stepId: string
  row: number
  col: number
  parentId: string | null
  step: PlanStep
}

interface LayoutEdge {
  fromId: string
  toId: string
}

interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  cols: number
  rows: number
}

function computeLayout(steps: PlanStep[], collapsedIds: Set<string>): LayoutResult {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  let maxCol = 0
  let maxRow = 0

  function walkChildren(children: PlanStep[], parentId: string | null, startRow: number): number {
    let row = startRow
    let i = 0
    while (i < children.length) {
      const step = children[i]
      const band: PlanStep[] = [step]
      while (i + 1 < children.length && children[i + 1].parallel) {
        band.push(children[++i])
      }

      if (band.length === 1) {
        const s = band[0]
        nodes.push({ stepId: s.id, row, col: 0, parentId, step: s })
        if (parentId) edges.push({ fromId: parentId, toId: s.id })
        if (maxRow < row) maxRow = row
        if (s.children && s.children.length > 0 && !collapsedIds.has(s.id)) {
          row = walkChildren(s.children, s.id, row + 1)
        } else {
          row++
        }
      } else {
        let bandMaxRow = row
        for (let b = 0; b < band.length; b++) {
          const s = band[b]
          const col = b
          if (col > maxCol) maxCol = col
          nodes.push({ stepId: s.id, row, col, parentId, step: s })
          if (parentId) edges.push({ fromId: parentId, toId: s.id })
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
  return { nodes, edges, cols: maxCol + 1, rows: maxRow + 1 }
}

function buildStepMap(steps: PlanStep[]): Map<string, PlanStep> {
  const map = new Map<string, PlanStep>()
  function walk(list: PlanStep[]) {
    for (const s of list) {
      map.set(s.id, s)
      if (s.children) walk(s.children)
    }
  }
  walk(steps)
  return map
}

function computeConnectedSet(nodeId: string, edges: LayoutEdge[]): Set<string> {
  const connected = new Set<string>()
  connected.add(nodeId)
  const parentMap = new Map<string, string[]>()
  const childMap = new Map<string, string[]>()
  for (const e of edges) {
    if (!parentMap.has(e.toId)) parentMap.set(e.toId, [])
    parentMap.get(e.toId)!.push(e.fromId)
    if (!childMap.has(e.fromId)) childMap.set(e.fromId, [])
    childMap.get(e.fromId)!.push(e.toId)
  }
  const queue = [nodeId]
  const visited = new Set<string>([nodeId])
  while (queue.length) {
    const cur = queue.pop()!
    for (const p of parentMap.get(cur) ?? []) {
      if (!visited.has(p)) { visited.add(p); connected.add(p); queue.push(p) }
    }
  }
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

function verticalBezierD(x1: number, y1: number, x2: number, y2: number): string {
  const cy = y1 + (y2 - y1) * 0.55
  return `M ${x1},${y1} C ${x1},${cy} ${x2},${cy} ${x2},${y2}`
}

function collectStepIds(steps: PlanStep[]): string[] {
  const ids: string[] = []
  for (const s of steps) {
    ids.push(s.id)
    if (s.children) ids.push(...collectStepIds(s.children))
  }
  return ids
}

function renderInlineCode(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={`code-${i}`}
          className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-slate-200 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={`txt-${i}`}>{part}</span>
  })
}

function estimateLines(text: string, charsPerLine: number): number {
  if (!text) return 0
  const hardLines = text.split('\n')
  let total = 0
  for (const line of hardLines) {
    total += Math.max(1, Math.ceil(line.length / Math.max(8, charsPerLine)))
  }
  return total
}

function estimateNodeHeight(
  step: PlanStep,
  nodeW: number,
  isSelected: boolean,
  isFolded: boolean,
  addedConstraintCount: number
): number {
  if (isFolded) return FOLDED_NODE_H
  const charsPerLine = Math.max(28, Math.floor((nodeW - 56) / 7.2))

  let lines = 0
  lines += 2 // header + id
  lines += estimateLines(step.label, charsPerLine)
  if (step.type === 'terminal') lines += 1
  if (step.description) lines += estimateLines(step.description, charsPerLine)
  if (step.files?.length) {
    lines += 1 // label
    for (const f of step.files) lines += estimateLines(f, charsPerLine)
  }
  if (step.constraints?.length) {
    lines += 1
    for (const c of step.constraints) lines += estimateLines(`- ${c}`, charsPerLine)
  }
  if (isSelected) {
    lines += 2 // guidance label + input row
    lines += step.constraints?.length ? Math.ceil(step.constraints.length / 2) : 0
    lines += addedConstraintCount ? Math.ceil(addedConstraintCount / 2) : 0
  }

  return Math.max(MIN_NODE_H, Math.min(900, 24 + lines * 18))
}

// ─── DagEdgeLayer ────────────────────────────────────────────────────────────

function DagEdgeLayer({
  edges,
  nodePositions,
  connectedSet,
  hoveredNodeId,
  nodeWidths,
  nodeHeights,
}: {
  edges: LayoutEdge[]
  nodePositions: Map<string, { x: number; y: number }>
  connectedSet: Set<string>
  hoveredNodeId: string | null
  nodeWidths: Map<string, number>
  nodeHeights: Map<string, number>
}) {
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      {edges.map(e => {
        const from = nodePositions.get(e.fromId)
        const to = nodePositions.get(e.toId)
        if (!from || !to) return null
        const fromW = nodeWidths.get(e.fromId) ?? DEFAULT_NODE_W
        const toW = nodeWidths.get(e.toId) ?? DEFAULT_NODE_W
        const fromCx = from.x + fromW / 2
        const toCx = to.x + toW / 2
        const x1 = Math.max(from.x, Math.min(from.x + fromW, toCx))
        const y1 = from.y + (nodeHeights.get(e.fromId) ?? MIN_NODE_H)
        const x2 = Math.max(to.x, Math.min(to.x + toW, fromCx))
        const y2 = to.y
        const isHighlighted = hoveredNodeId ? connectedSet.has(e.fromId) && connectedSet.has(e.toId) : false
        const isDimmed = hoveredNodeId && !isHighlighted
        return (
          <path
            key={`${e.fromId}-${e.toId}`}
            d={verticalBezierD(x1, y1, x2, y2)}
            fill="none"
            stroke={isHighlighted ? 'var(--c-curve-hi)' : 'var(--c-curve-lo)'}
            strokeWidth={isHighlighted ? 2 : 1.5}
            opacity={isDimmed ? 0.3 : 1}
            style={{ transition: 'stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease' }}
          />
        )
      })}
    </svg>
  )
}

// ─── PlanDagNode ─────────────────────────────────────────────────────────────

function PlanDagNode({
  node,
  x,
  y,
  nodeW,
  nodeH,
  isHovered,
  isSelected,
  isDimmed,
  hasChildren,
  isCollapsed,
  isRemoved,
  isSkipped,
  isModified,
  isInserted,
  stepConstraints,
  onAddConstraint,
  onRemoveConstraint,
  isFolded,
  onToggleFold,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  node: LayoutNode
  x: number
  y: number
  nodeW: number
  nodeH: number
  isHovered: boolean
  isSelected: boolean
  isDimmed: boolean
  hasChildren: boolean
  isCollapsed: boolean
  isRemoved: boolean
  isSkipped: boolean
  isModified: boolean
  isInserted: boolean
  stepConstraints: string[]
  onAddConstraint: (id: string, constraint: string) => void
  onRemoveConstraint: (id: string, index: number) => void
  isFolded: boolean
  onToggleFold: (id: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
}) {
  const step = node.step
  const riskColor = step.risk ? `var(--c-risk-${step.risk})` : undefined
  const textClass = isRemoved ? 'line-through text-zinc-400 dark:text-slate-500' : 'text-zinc-700 dark:text-slate-300'
  const [inlineConstraint, setInlineConstraint] = useState('')
  const allConstraints = [...(step.constraints ?? []), ...stepConstraints]

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: nodeW,
        minHeight: nodeH,
        transform: isHovered ? 'scale(1.015)' : 'scale(1)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.25s ease',
        opacity: isDimmed || isSkipped ? 0.4 : isRemoved ? 0.5 : 1,
        zIndex: isHovered ? 10 : 1,
        cursor: 'pointer',
      }}
      className={`rounded-lg border px-3 py-2 ${
        isSelected
          ? 'border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-900'
          : isRemoved
            ? 'border-red-300 dark:border-red-700'
            : isInserted
              ? 'border-blue-300 dark:border-blue-700'
              : 'border-gray-200 dark:border-zinc-700'
      }`}
      role="button"
      tabIndex={0}
      onKeyDown={e => { const t = e.target as HTMLElement; if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Step ${node.stepId}: ${step.label}`}
    >
      <div
        style={{
          backgroundColor: 'var(--c-surface)',
          boxShadow: isHovered
            ? '0 4px 12px var(--c-dag-node-shadow)'
            : '0 1px 3px var(--c-dag-node-shadow)',
          borderLeft: riskColor ? `3px solid ${riskColor}` : undefined,
          borderRadius: 'inherit',
          padding: 'inherit',
          margin: '-0.5rem -0.75rem',
          borderStyle: isRemoved ? 'dashed' : isInserted ? 'dashed' : undefined,
          minHeight: nodeH,
        }}
      >
        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-2">
          <PlanTypeBadge type={step.type} />
          <span className="flex-1" />
          {isModified && (
            <span className="w-2 h-2 rounded-full bg-blue-500" title="Modified" />
          )}
          {step.optional && !isSkipped && (
            <span className="text-[10px] text-zinc-400 dark:text-slate-500 italic">opt</span>
          )}
          {step.risk && <RiskBadge risk={step.risk} />}
          {step.estimatedDuration && (
            <span className="text-[10px] text-zinc-400 dark:text-slate-500 tabular-nums">{step.estimatedDuration}</span>
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
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFold(node.stepId) }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-zinc-700 text-zinc-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
          >
            {isFolded ? 'Expand' : 'Fold'}
          </button>
        </div>

        <p className="text-[10px] font-mono text-zinc-400 dark:text-slate-500 mb-1">ID: {node.stepId}</p>

        {step.type === 'terminal' ? (
          <pre className={`text-xs mt-1 p-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 font-mono whitespace-pre-wrap break-all ${textClass}`}>
            <code>{step.label}</code>
          </pre>
        ) : (
          <p className={`text-sm font-medium leading-snug whitespace-pre-wrap break-words ${textClass}`}>
            {renderInlineCode(step.label)}
          </p>
        )}

        {!isFolded && step.description && (
          <p className={`text-xs mt-2 leading-relaxed whitespace-pre-wrap break-words ${textClass}`}>
            {renderInlineCode(step.description)}
          </p>
        )}

        {!isFolded && step.files && step.files.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium text-zinc-400 dark:text-slate-500 uppercase">Files</p>
            <div className="mt-1 space-y-1">
              {step.files.map(file => (
                <p key={file} className={`text-xs font-mono whitespace-pre-wrap break-all ${textClass}`}>{file}</p>
              ))}
            </div>
          </div>
        )}

        {!isFolded && step.constraints && step.constraints.length > 0 && !isSelected && (
          <div className="mt-2">
            <p className="text-[10px] font-medium text-zinc-400 dark:text-slate-500 uppercase">Constraints</p>
            <p className={`text-xs mt-1 whitespace-pre-wrap break-words ${textClass}`}>
              {step.constraints.map(c => `- ${c}`).join('\n')}
            </p>
          </div>
        )}

        {!isFolded && isSelected && (
          <div className="mt-3 pt-2 border-t border-gray-200 dark:border-zinc-700">
            <p className="text-[10px] font-medium text-zinc-500 dark:text-slate-400 uppercase mb-1">
              Guidance / Constraint
            </p>
            {allConstraints.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {allConstraints.map((c, idx) => (
                  <span key={`${node.stepId}-c-${idx}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    {c}
                    {idx >= (step.constraints ?? []).length && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveConstraint(node.stepId, idx - (step.constraints ?? []).length) }}
                        className="text-amber-500 hover:text-amber-700 text-[10px] ml-0.5"
                        aria-label={`Remove constraint ${idx + 1}`}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add guidance or constraint..."
                value={inlineConstraint}
                onClick={(e) => e.stopPropagation()}
                onChange={e => setInlineConstraint(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && inlineConstraint.trim()) {
                    e.preventDefault()
                    e.stopPropagation()
                    onAddConstraint(node.stepId, inlineConstraint.trim())
                    setInlineConstraint('')
                  }
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!inlineConstraint.trim()) return
                  onAddConstraint(node.stepId, inlineConstraint.trim())
                  setInlineConstraint('')
                }}
                className="text-xs px-2 py-1 text-blue-500 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PlanNodeDetail ──────────────────────────────────────────────────────────

function PlanNodeDetail({
  step,
  isRemoved,
  isSkipped,
  modification,
  stepConstraints,
  onClose,
  onRemove,
  onUndoRemove,
  onToggleSkip,
  onModify,
  onAddConstraint,
  onRemoveConstraint,
}: {
  step: PlanStep
  isRemoved: boolean
  isSkipped: boolean
  modification?: StepModification
  stepConstraints: string[]
  onClose: () => void
  onRemove: (id: string) => void
  onUndoRemove: (id: string) => void
  onToggleSkip: (id: string) => void
  onModify: (id: string, mod: StepModification) => void
  onAddConstraint: (id: string, constraint: string) => void
  onRemoveConstraint: (id: string, index: number) => void
}) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [labelVal, setLabelVal] = useState(modification?.label ?? step.label)
  const [descVal, setDescVal] = useState(modification?.description ?? step.description ?? '')
  const [newConstraint, setNewConstraint] = useState('')

  const allConstraints = [...(step.constraints ?? []), ...stepConstraints]

  return (
    <div className="mt-4 p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <PlanTypeBadge type={modification?.type ?? step.type} />
          {step.risk && <RiskBadge risk={step.risk} />}
          {step.optional && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 italic">optional</span>
          )}
          {step.estimatedDuration && (
            <span className="text-xs text-zinc-400 dark:text-slate-500">{step.estimatedDuration}</span>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-slate-300 text-sm ml-4">&times;</button>
      </div>

      {/* Editable label */}
      {editingLabel ? (
        <div className="flex gap-2 items-center mb-2">
          <input
            className="flex-1 text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => { onModify(step.id, { ...modification, label: labelVal }); setEditingLabel(false) }}
            className="text-xs px-2 py-1 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded"
          >Save</button>
          <button
            onClick={() => { setLabelVal(modification?.label ?? step.label); setEditingLabel(false) }}
            className="text-xs px-2 py-1 text-zinc-500 dark:text-slate-400 border border-gray-200 dark:border-zinc-700 rounded"
          >Cancel</button>
        </div>
      ) : (
        <p
          className={`text-sm font-medium cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 ${isRemoved ? 'line-through text-zinc-400' : 'text-zinc-800 dark:text-slate-200'}`}
          onClick={() => setEditingLabel(true)}
          title="Click to edit"
        >
          {modification?.label ?? step.label}
        </p>
      )}

      {/* Editable description */}
      {editingDesc ? (
        <div className="mt-2">
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            value={descVal}
            onChange={e => setDescVal(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => { onModify(step.id, { ...modification, description: descVal }); setEditingDesc(false) }}
              className="text-xs px-2 py-1 bg-zinc-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded"
            >Save</button>
            <button
              onClick={() => { setDescVal(modification?.description ?? step.description ?? ''); setEditingDesc(false) }}
              className="text-xs px-2 py-1 text-zinc-500 dark:text-slate-400 border border-gray-200 dark:border-zinc-700 rounded"
            >Cancel</button>
          </div>
        </div>
      ) : (
        (step.description || modification?.description) && (
          <p
            className="text-xs text-zinc-500 dark:text-slate-400 mt-1 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
            onClick={() => setEditingDesc(true)}
            title="Click to edit"
          >
            {modification?.description ?? step.description}
          </p>
        )
      )}

      {/* Files */}
      {step.files && step.files.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-medium text-zinc-400 dark:text-slate-500 uppercase mb-1">Files</p>
          <div className="flex flex-wrap gap-1">
            {step.files.map(f => (
              <span key={f} className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-slate-400">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Constraints */}
      <div className="mt-3">
        <p className="text-[10px] font-medium text-zinc-400 dark:text-slate-500 uppercase mb-1">Constraints</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {allConstraints.map((c, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              {c}
              {idx >= (step.constraints ?? []).length && (
                <button
                  onClick={() => onRemoveConstraint(step.id, idx - (step.constraints ?? []).length)}
                  className="text-amber-400 hover:text-amber-600 text-[10px] ml-0.5"
                >&times;</button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Add constraint..."
            value={newConstraint}
            onChange={e => setNewConstraint(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newConstraint.trim()) {
                onAddConstraint(step.id, newConstraint.trim())
                setNewConstraint('')
              }
            }}
          />
          <button
            onClick={() => { if (newConstraint.trim()) { onAddConstraint(step.id, newConstraint.trim()); setNewConstraint('') } }}
            className="text-xs px-2 py-1 text-blue-500 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950"
          >+</button>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {step.optional && (
          <button
            onClick={() => onToggleSkip(step.id)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              isSkipped
                ? 'border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950'
                : 'border-gray-200 dark:border-zinc-700 text-zinc-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-zinc-800'
            }`}
          >
            {isSkipped ? 'Unskip' : 'Skip'}
          </button>
        )}
        {isRemoved ? (
          <button
            onClick={() => onUndoRemove(step.id)}
            className="text-xs px-2 py-1 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 rounded hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
          >
            Undo Remove
          </button>
        ) : (
          <button
            onClick={() => onRemove(step.id)}
            className="text-xs px-2 py-1 text-red-500 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ─── PlanInsertButton ────────────────────────────────────────────────────────

function PlanInsertButton({
  afterId,
  isActive,
  onClick,
}: {
  afterId: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        isActive
          ? 'bg-blue-500 text-white scale-110'
          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-blue-400 hover:text-white hover:scale-110'
      }`}
      title="Insert step here"
    >
      +
    </button>
  )
}

// ─── Insert step form ────────────────────────────────────────────────────────

function InsertStepForm({
  afterId,
  onInsert,
  onCancel,
}: {
  afterId: string
  onInsert: (insertion: StepInsertion) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<PlanStepType>('action')

  const handleSubmit = () => {
    if (!label.trim()) return
    onInsert({
      afterId,
      step: {
        id: `inserted_${Date.now()}`,
        type,
        label: label.trim(),
        description: description.trim() || undefined,
      },
    })
  }

  return (
    <div className="mt-2 p-3 bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 rounded-lg space-y-2" style={{ borderStyle: 'dashed' }}>
      <p className="text-xs font-medium text-blue-500">Insert step after {afterId}</p>
      <div>
        <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Label</label>
        <input
          className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={label}
          onChange={e => setLabel(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Type</label>
        <select
          className="text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={type}
          onChange={e => setType(e.target.value as PlanStepType)}
        >
          <option value="action">action</option>
          <option value="research">research</option>
          <option value="code">code</option>
          <option value="terminal">terminal</option>
          <option value="agent_delegate">agent_delegate</option>
          <option value="decision">decision</option>
          <option value="checkpoint">checkpoint</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Description (optional)</label>
        <textarea
          className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!label.trim()}
          className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors font-medium disabled:opacity-50"
        >
          Insert
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

// ─── AlternativeTabBar ───────────────────────────────────────────────────────

function AlternativeTabBar({
  alternatives,
  selectedAlternative,
  onSelect,
}: {
  alternatives: AlternativePlan[]
  selectedAlternative: string | null
  onSelect: (name: string | null) => void
}) {
  return (
    <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-zinc-700">
      <button
        className={`text-xs px-3 py-2 font-medium transition-colors border-b-2 ${
          selectedAlternative === null
            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
            : 'border-transparent text-zinc-500 dark:text-slate-400 hover:text-zinc-700 dark:hover:text-slate-300'
        }`}
        onClick={() => onSelect(null)}
      >
        Primary Plan
      </button>
      {alternatives.map(alt => (
        <button
          key={alt.name}
          className={`text-xs px-3 py-2 font-medium transition-colors border-b-2 ${
            selectedAlternative === alt.name
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-zinc-500 dark:text-slate-400 hover:text-zinc-700 dark:hover:text-slate-300'
          }`}
          onClick={() => onSelect(alt.name)}
          title={alt.description}
        >
          {alt.name}
        </button>
      ))}
    </div>
  )
}

// ─── PlanDagCanvas ───────────────────────────────────────────────────────────

function PlanDagCanvas({
  layout,
  collapsedIds,
  onToggleCollapse,
  stepMap,
  removals,
  skippedIds,
  modifications,
  insertions,
  constraints,
  insertingAfter,
  onSetInsertingAfter,
  onRemove,
  onUndoRemove,
  onToggleSkip,
  onModify,
  onAddConstraint,
  onRemoveConstraint,
  onInsert,
}: {
  layout: LayoutResult
  collapsedIds: Set<string>
  onToggleCollapse: (id: string) => void
  stepMap: Map<string, PlanStep>
  removals: Set<string>
  skippedIds: Set<string>
  modifications: Map<string, StepModification>
  insertions: StepInsertion[]
  constraints: Map<string, string[]>
  insertingAfter: string | null | undefined
  onSetInsertingAfter: (id: string | null) => void
  onRemove: (id: string) => void
  onUndoRemove: (id: string) => void
  onToggleSkip: (id: string) => void
  onModify: (id: string, mod: StepModification) => void
  onAddConstraint: (id: string, constraint: string) => void
  onRemoveConstraint: (id: string, index: number) => void
  onInsert: (insertion: StepInsertion) => void
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set())
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportW, setViewportW] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => setViewportW(el.clientWidth)
    update()
    const obs = new ResizeObserver(() => update())
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Per-row column counts
  const rowColCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of layout.nodes) m.set(n.row, Math.max(m.get(n.row) ?? 0, n.col + 1))
    return m
  }, [layout.nodes])

  // Per-row node width: single-step rows fill available width; parallel rows split adaptively
  const rowWidths = useMemo(() => {
    const m = new Map<number, number>()
    const usable = Math.max(0, viewportW > 0 ? viewportW - 48 : DEFAULT_NODE_W * 2)
    for (const [row, cols] of rowColCounts) {
      const rowUsable = usable - (cols - 1) * GAP_X
      const perCol = Math.floor(rowUsable / cols)
      const maxW = cols > 1 ? Math.min(MAX_NODE_W, 360) : MAX_NODE_W
      m.set(row, Math.max(MIN_NODE_W, Math.min(maxW, perCol)))
    }
    return m
  }, [viewportW, rowColCounts])

  // Per-node width lookup
  const nodeWidths = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of layout.nodes) m.set(n.stepId, rowWidths.get(n.row) ?? DEFAULT_NODE_W)
    return m
  }, [layout.nodes, rowWidths])

  const nodeHeights = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of layout.nodes) {
      map.set(
        n.stepId,
        estimateNodeHeight(
          n.step,
          nodeWidths.get(n.stepId) ?? DEFAULT_NODE_W,
          selectedNodeId === n.stepId,
          foldedIds.has(n.stepId),
          (constraints.get(n.stepId) ?? []).length
        )
      )
    }
    return map
  }, [layout.nodes, nodeWidths, selectedNodeId, foldedIds, constraints])

  const rowOffsets = useMemo(() => {
    const maxByRow = new Map<number, number>()
    for (const n of layout.nodes) {
      const h = nodeHeights.get(n.stepId) ?? MIN_NODE_H
      const prev = maxByRow.get(n.row) ?? 0
      if (h > prev) maxByRow.set(n.row, h)
    }
    const offsets = new Map<number, number>()
    let y = 0
    for (let r = 0; r < layout.rows; r++) {
      offsets.set(r, y)
      y += (maxByRow.get(r) ?? MIN_NODE_H) + GAP_Y
    }
    return { offsets, maxByRow, totalHeight: Math.max(0, y - GAP_Y) }
  }, [layout.nodes, layout.rows, nodeHeights])

  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    for (const n of layout.nodes) {
      const w = rowWidths.get(n.row) ?? DEFAULT_NODE_W
      positions.set(n.stepId, {
        x: n.col * (w + GAP_X),
        y: rowOffsets.offsets.get(n.row) ?? 0,
      })
    }
    return positions
  }, [layout.nodes, rowWidths, rowOffsets.offsets])

  const connectedSet = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>()
    return computeConnectedSet(hoveredNodeId, layout.edges)
  }, [hoveredNodeId, layout.edges])

  const canvasW = Math.max(0, ...Array.from(rowColCounts.entries()).map(([row, cols]) => {
    const w = rowWidths.get(row) ?? DEFAULT_NODE_W
    return cols * w + (cols - 1) * GAP_X
  }))
  const canvasH = rowOffsets.totalHeight

  const selectedStep = selectedNodeId ? stepMap.get(selectedNodeId) : null

  // Collect insert button positions — between each sequential row
  const insertPositions = useMemo(() => {
    const positions: { afterId: string; x: number; y: number }[] = []
    const seqNodes = layout.nodes.filter(n => n.col === 0)
    for (let i = 0; i < seqNodes.length; i++) {
      const node = seqNodes[i]
      const pos = nodePositions.get(node.stepId)
      if (pos) {
        positions.push({
          afterId: node.stepId,
          x: pos.x + (nodeWidths.get(node.stepId) ?? DEFAULT_NODE_W) / 2 - 12,
          y: pos.y + (nodeHeights.get(node.stepId) ?? MIN_NODE_H) + (GAP_Y / 2) - 12,
        })
      }
    }
    return positions
  }, [layout.nodes, nodePositions, nodeWidths, nodeHeights])

  const handleNodeClick = useCallback((stepId: string, hasChildren: boolean) => {
    if (hasChildren) {
      onToggleCollapse(stepId)
    }
    setSelectedNodeId(prev => prev === stepId ? null : stepId)
  }, [onToggleCollapse])

  const toggleFold = useCallback((stepId: string) => {
    setFoldedIds(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }, [])

  const insertedIds = new Set(insertions.map(ins => ins.step.id))

  return (
    <div>
      <div
        ref={viewportRef}
        className="overflow-x-auto rounded-lg border border-gray-100 dark:border-zinc-800"
        style={{ backgroundColor: 'var(--c-dag-bg)' }}
      >
        <div style={{ position: 'relative', width: canvasW + 48, height: canvasH + 48, minWidth: '100%' }}>
          <div style={{ position: 'absolute', left: '50%', top: 24, transform: `translateX(-${canvasW / 2}px)`, width: canvasW, height: canvasH }}>
            <DagEdgeLayer
              edges={layout.edges}
              nodePositions={nodePositions}
              connectedSet={connectedSet}
              hoveredNodeId={hoveredNodeId}
              nodeWidths={nodeWidths}
              nodeHeights={nodeHeights}
            />

            {layout.nodes.map(n => {
              const pos = nodePositions.get(n.stepId)!
              const step = n.step
              const hasChildren = !!(step.children && step.children.length > 0)
              return (
                <PlanDagNode
                  key={n.stepId}
                  node={n}
                  x={pos.x}
                  y={pos.y}
                  nodeW={nodeWidths.get(n.stepId) ?? DEFAULT_NODE_W}
                  nodeH={nodeHeights.get(n.stepId) ?? MIN_NODE_H}
                  isHovered={hoveredNodeId === n.stepId}
                  isSelected={selectedNodeId === n.stepId}
                  isDimmed={!!hoveredNodeId && !connectedSet.has(n.stepId)}
                  hasChildren={hasChildren}
                  isCollapsed={collapsedIds.has(n.stepId)}
                  isRemoved={removals.has(n.stepId)}
                  isSkipped={skippedIds.has(n.stepId)}
                  isModified={modifications.has(n.stepId)}
                  isInserted={insertedIds.has(n.stepId)}
                  stepConstraints={constraints.get(n.stepId) ?? []}
                  onAddConstraint={onAddConstraint}
                  onRemoveConstraint={onRemoveConstraint}
                  isFolded={foldedIds.has(n.stepId)}
                  onToggleFold={toggleFold}
                  onMouseEnter={() => setHoveredNodeId(n.stepId)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={() => handleNodeClick(n.stepId, hasChildren)}
                />
              )
            })}

            {/* Insert buttons */}
            {insertPositions.map(pos => (
              <div key={`ins-${pos.afterId}`} style={{ position: 'absolute', left: pos.x, top: pos.y, zIndex: 5 }}>
                <PlanInsertButton
                  afterId={pos.afterId}
                  isActive={insertingAfter === pos.afterId}
                  onClick={() => onSetInsertingAfter(insertingAfter === pos.afterId ? null : pos.afterId)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Insert form */}
      {insertingAfter && (
        <InsertStepForm
          afterId={insertingAfter}
          onInsert={(ins) => { onInsert(ins); onSetInsertingAfter(null) }}
          onCancel={() => onSetInsertingAfter(null)}
        />
      )}

      {/* Detail panel */}
      {selectedStep && (
        <PlanNodeDetail
          step={selectedStep}
          isRemoved={removals.has(selectedNodeId!)}
          isSkipped={skippedIds.has(selectedNodeId!)}
          modification={modifications.get(selectedNodeId!)}
          stepConstraints={constraints.get(selectedNodeId!) ?? []}
          onClose={() => setSelectedNodeId(null)}
          onRemove={onRemove}
          onUndoRemove={onUndoRemove}
          onToggleSkip={onToggleSkip}
          onModify={onModify}
          onAddConstraint={onAddConstraint}
          onRemoveConstraint={onRemoveConstraint}
        />
      )}
    </div>
  )
}

// ─── Merge insertions into steps array ───────────────────────────────────────

function mergeInsertions(steps: PlanStep[], insertions: StepInsertion[]): PlanStep[] {
  if (insertions.length === 0) return steps
  const result: PlanStep[] = []
  const insertMap = new Map<string, PlanStep[]>()
  for (const ins of insertions) {
    if (!insertMap.has(ins.afterId)) insertMap.set(ins.afterId, [])
    insertMap.get(ins.afterId)!.push(ins.step)
  }

  function walk(list: PlanStep[]) {
    for (const s of list) {
      const merged: PlanStep = s.children
        ? { ...s, children: mergeInsertions(s.children, insertions) }
        : s
      result.push(merged)
      const inserted = insertMap.get(s.id)
      if (inserted) {
        for (const ins of inserted) result.push(ins)
      }
    }
  }
  walk(steps)
  return result
}

// ─── PlanPageInner ───────────────────────────────────────────────────────────

function PlanPageInner() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // Fetch state
  const [payload, setPayload] = useState<PlanPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [callbackFailed, setCallbackFailed] = useState(false)

  // Rewrite cycle
  const [sessionStatus, setSessionStatus] = useState<string>('pending')
  const statusRef = useRef(sessionStatus)
  statusRef.current = sessionStatus

  // DAG state
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  // Editing state
  const [removals, setRemovals] = useState<Set<string>>(new Set())
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())
  const [modifications, setModifications] = useState<Map<string, StepModification>>(new Map())
  const [insertions, setInsertions] = useState<StepInsertion[]>([])
  const [constraints, setConstraints] = useState<Map<string, string[]>>(new Map())
  const [globalNote, setGlobalNote] = useState('')
  const [globalConstraints, setGlobalConstraints] = useState<string[]>([])
  const [selectedAlternative, setSelectedAlternative] = useState<string | null>(null)
  const [insertingAfter, setInsertingAfter] = useState<string | null>(null)
  const [newGlobalConstraint, setNewGlobalConstraint] = useState('')

  // Initial fetch
  useEffect(() => {
    fetch(`/api/sessions/${id}`)
      .then(r => r.json())
      .then(data => {
        setPayload(data.payload as PlanPayload)
        setSessionStatus(data.status)
        setLoading(false)
      })
      .catch(() => { setFetchError(true); setLoading(false) })
  }, [id])

  // Poll for rewrite cycle
  useEffect(() => {
    const interval = setInterval(() => {
      if (statusRef.current !== 'rewriting') return
      fetch(`/api/sessions/${id}`)
        .then(r => r.json())
        .then(data => {
          const newStatus = data.status as string
          if (newStatus === 'pending') {
            setPayload(data.payload as PlanPayload)
            resetEditState()
          }
          setSessionStatus(newStatus)
        })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(interval)
  }, [id])

  function resetEditState() {
    setRemovals(new Set())
    setSkippedIds(new Set())
    setModifications(new Map())
    setInsertions([])
    setConstraints(new Map())
    setGlobalNote('')
    setGlobalConstraints([])
    setSelectedAlternative(null)
    setInsertingAfter(null)
    setCollapsedIds(new Set())
  }

  // Active steps (primary or selected alternative)
  const activeSteps = useMemo(() => {
    if (!payload) return []
    if (selectedAlternative && payload.alternatives) {
      const alt = payload.alternatives.find(a => a.name === selectedAlternative)
      if (alt) return alt.steps
    }
    return payload.steps
  }, [payload, selectedAlternative])

  // Merge insertions into steps for layout
  const mergedSteps = useMemo(() => mergeInsertions(activeSteps, insertions), [activeSteps, insertions])

  const stepMap = useMemo(() => buildStepMap(mergedSteps), [mergedSteps])

  const layout = useMemo(() => {
    if (mergedSteps.length === 0) return { nodes: [], edges: [], cols: 0, rows: 0 }
    return computeLayout(mergedSteps, collapsedIds)
  }, [mergedSteps, collapsedIds])

  const toggleCollapse = useCallback((stepId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }, [])

  const handleSwitchAlternative = (name: string | null) => {
    setSelectedAlternative(name)
    resetEditState()
    // Restore the alternative selection after reset
    setSelectedAlternative(name)
  }

  const handleRemove = (id: string) => {
    setRemovals(prev => new Set(prev).add(id))
  }

  const handleUndoRemove = (id: string) => {
    setRemovals(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const handleToggleSkip = (id: string) => {
    setSkippedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleModify = (id: string, mod: StepModification) => {
    setModifications(prev => new Map(prev).set(id, mod))
  }

  const handleAddConstraint = (stepId: string, constraint: string) => {
    setConstraints(prev => {
      const next = new Map(prev)
      const existing = next.get(stepId) ?? []
      next.set(stepId, [...existing, constraint])
      return next
    })
  }

  const handleRemoveConstraint = (stepId: string, index: number) => {
    setConstraints(prev => {
      const next = new Map(prev)
      const existing = [...(next.get(stepId) ?? [])]
      existing.splice(index, 1)
      if (existing.length === 0) next.delete(stepId)
      else next.set(stepId, existing)
      return next
    })
  }

  const handleInsert = (insertion: StepInsertion) => {
    setInsertions(prev => [...prev, insertion])
  }

  const submit = async (approved: boolean) => {
    setSubmitting(true)
    const body = {
      approved,
      selectedAlternative: selectedAlternative || undefined,
      modifications: Object.fromEntries(modifications),
      insertions: insertions.map(ins => ({ afterId: ins.afterId, step: ins.step })),
      removals: Array.from(removals),
      skipped: Array.from(skippedIds),
      constraints: Object.fromEntries(constraints),
      globalConstraints: globalConstraints.length > 0 ? globalConstraints : undefined,
      globalNote: globalNote || undefined,
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

  const requestRegenerate = async () => {
    setSubmitting(true)
    const body = {
      regenerate: true,
      approved: false,
      selectedAlternative: selectedAlternative || undefined,
      modifications: Object.fromEntries(modifications),
      insertions: insertions.map(ins => ({ afterId: ins.afterId, step: ins.step })),
      removals: Array.from(removals),
      skipped: Array.from(skippedIds),
      constraints: Object.fromEntries(constraints),
      globalConstraints: globalConstraints.length > 0 ? globalConstraints : undefined,
      globalNote: globalNote || undefined,
    }
    await fetch(`/api/sessions/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSessionStatus('rewriting')
    setSubmitting(false)
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
        <p className="text-zinc-700 dark:text-slate-200 font-medium">Agent is regenerating...</p>
        <p className="text-zinc-400 dark:text-slate-500 text-sm mt-1">Waiting for updated plan.</p>
      </div>
    </div>
  )

  const editCount = removals.size + skippedIds.size + modifications.size + insertions.length
    + Array.from(constraints.values()).reduce((sum, c) => sum + c.length, 0)

  // ─── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-4xl mx-auto py-10 px-4">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-zinc-400 dark:text-slate-500 uppercase tracking-wider mb-1">Plan Review</p>
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

        {/* Alternative tabs */}
        {payload.alternatives && payload.alternatives.length > 0 && (
          <AlternativeTabBar
            alternatives={payload.alternatives}
            selectedAlternative={selectedAlternative}
            onSelect={handleSwitchAlternative}
          />
        )}

        {/* DAG */}
        <div className="mb-6">
          <PlanDagCanvas
            layout={layout}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapse}
            stepMap={stepMap}
            removals={removals}
            skippedIds={skippedIds}
            modifications={modifications}
            insertions={insertions}
            constraints={constraints}
            insertingAfter={insertingAfter}
            onSetInsertingAfter={setInsertingAfter}
            onRemove={handleRemove}
            onUndoRemove={handleUndoRemove}
            onToggleSkip={handleToggleSkip}
            onModify={handleModify}
            onAddConstraint={handleAddConstraint}
            onRemoveConstraint={handleRemoveConstraint}
            onInsert={handleInsert}
          />
        </div>

        {/* Global constraints */}
        <div className="mb-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Global constraints</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {globalConstraints.map((c, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                {c}
                <button
                  onClick={() => setGlobalConstraints(prev => prev.filter((_, i) => i !== idx))}
                  className="text-amber-400 hover:text-amber-600 text-[10px] ml-0.5"
                >&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              className="flex-1 text-sm border border-gray-200 dark:border-zinc-700 rounded px-3 py-2 text-zinc-700 dark:text-slate-300 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add a global constraint..."
              value={newGlobalConstraint}
              onChange={e => setNewGlobalConstraint(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newGlobalConstraint.trim()) {
                  setGlobalConstraints(prev => [...prev, newGlobalConstraint.trim()])
                  setNewGlobalConstraint('')
                }
              }}
            />
            <button
              onClick={() => { if (newGlobalConstraint.trim()) { setGlobalConstraints(prev => [...prev, newGlobalConstraint.trim()]); setNewGlobalConstraint('') } }}
              className="text-sm px-3 py-2 text-blue-500 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-50 dark:hover:bg-blue-950"
            >+</button>
          </div>
        </div>

        {/* Global note */}
        <div className="mb-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-slate-400 block mb-1">Note for agent</label>
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-700 dark:text-slate-300 bg-white dark:bg-zinc-900 placeholder-zinc-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={2}
            placeholder="Add a note for the agent (optional)"
            value={globalNote}
            onChange={e => setGlobalNote(e.target.value)}
          />
        </div>

        {/* Edit summary */}
        {editCount > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
              {editCount} edit{editCount !== 1 ? 's' : ''} pending
              {removals.size > 0 && ` (${removals.size} removed)`}
              {skippedIds.size > 0 && ` (${skippedIds.size} skipped)`}
              {insertions.length > 0 && ` (${insertions.length} inserted)`}
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
            Approve Plan
          </button>
          <button
            onClick={requestRegenerate}
            disabled={submitting}
            className={`px-5 text-sm text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Regenerate
          </button>
          <button
            onClick={() => submit(false)}
            disabled={submitting}
            className={`px-5 text-sm text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 transition-colors ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Reject
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Exported page with error boundary ────────────────────────────────────────

export default function PlanPage() {
  return (
    <ErrorBoundary>
      <PlanPageInner />
    </ErrorBoundary>
  )
}
