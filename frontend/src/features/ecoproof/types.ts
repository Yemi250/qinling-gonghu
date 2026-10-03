// EcoProof visitor display types. The parent owns fetching, timing and business
// results; these types describe what the components in this folder render.
// Nothing here calls an API or produces analysis outcomes.

/** Overall outcome of one EcoProof run, as reported by the parent. */
export type ProofRunState = 'idle' | 'running' | 'succeeded' | 'partial' | 'failed'

/** Outcome of a single fixed stage inside the run. */
export type ProofStepState =
  | 'idle'
  | 'running'
  | 'pass'
  | 'attention'
  | 'failed'
  | 'skipped'

/** Who produced a piece of evidence. Displayed so sources stay distinguishable. */
export type EvidenceSource = 'system' | 'visitor' | 'model'

export type ProofEvidence = {
  /** Short name of the checked fact. Location facts read 游客选择的点位, report time reads 提交时间. */
  label: string
  /** What was observed, copied verbatim from the parent. */
  value: string
  source: EvidenceSource
}

export type ProofStep = {
  /** One of the four fixed stage keys: material | content | association | decision. */
  key: string
  state: ProofStepState
  /** One short line shown beside the stage title. */
  message: string
  evidence: ProofEvidence[]
}

export type ProofConclusionKind =
  | 'process'
  | 'supplement'
  | 'merge'
  | 'no_issue'
  | 'human_review'

export type ProofConclusion = {
  kind: ProofConclusionKind
  /** Why this suggestion holds, in one or two short sentences from the parent. */
  reason: string
}

export type VisitorProofCardProps = {
  runState: ProofRunState
  /** True when the latest finished run no longer reflects the current record. */
  stale: boolean
  /** Per-stage results. Stage order and titles are fixed inside the component. */
  steps: ProofStep[]
  conclusion: ProofConclusion | null
  /** Model identifier as returned by the server, shown verbatim. */
  model: string | null
  startedAt: string | null
  finishedAt: string | null
  /** True while the parent has a run in flight; the card only reflects it. */
  busy: boolean
  /** Readable failure message for the latest run, if any. */
  error: string | null
  onStart?: () => void
  onRetry?: () => void
}

/** One progress note in the merged case timeline. */
export type SharedCaseMilestone = {
  label: string
  createdAt: string
  note: string
}

export type SharedCaseFeedbackProps = {
  /** Code of the merged governance case, e.g. QL-XXXXXXXX. */
  caseCode?: string
  /** Current case status in the parent's own wording. */
  statusLabel?: string
  /** Point name of the visitor's own submission. */
  pointName?: string
  submissionCount?: number
  uniqueImageCount?: number
  duplicateImageCount?: number
  milestones?: SharedCaseMilestone[]
  closedAt?: string | null
  closingNote?: string | null
}
