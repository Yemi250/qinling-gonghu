import type { ReactNode } from 'react'
import { Check, LoaderCircle, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { formatTime } from '../../components/format'
import type {
  EvidenceSource,
  ProofConclusionKind,
  ProofRunState,
  ProofStep,
  ProofStepState,
  VisitorProofCardProps,
} from './types'
import './ecoproof.css'

// The stage rail is fixed here so every run reads in the same order; the parent
// only supplies per-stage results keyed by these keys. Unknown keys are ignored.
const STAGES: { key: string; title: string; waiting: string }[] = [
  { key: 'material', title: '材料检查', waiting: '等待检查材料是否完整' },
  { key: 'content', title: '内容分析', waiting: '等待整理照片和描述里的线索' },
  { key: 'association', title: '关联线索比对', waiting: '等待与其他线索比对' },
  { key: 'decision', title: '处置建议', waiting: '等待形成处置建议' },
]

const RUN_STATE_LABELS: Record<ProofRunState, string> = {
  idle: '未开始',
  running: '分析中',
  succeeded: '已完成',
  partial: '部分完成',
  failed: '未完成',
}

const STEP_STATE_LABELS: Record<ProofStepState, string> = {
  idle: '未开始',
  running: '进行中',
  pass: '已通过',
  attention: '需注意',
  failed: '未通过',
  skipped: '已跳过',
}

// Fixed Chinese wording for each conclusion kind; the reason text stays the parent's.
const CONCLUSION_LABELS: Record<ProofConclusionKind, string> = {
  process: '建议审核处置',
  supplement: '需要补充',
  merge: '建议合并',
  no_issue: '未见明显问题',
  human_review: '人工复核',
}

const SOURCE_LABELS: Record<EvidenceSource, string> = {
  system: '系统检查',
  visitor: '游客填写',
  model: '模型分析',
}

const CONCLUSION_TONES: Record<ProofConclusionKind, 'accent' | 'attention' | 'calm'> = {
  process: 'accent',
  merge: 'accent',
  no_issue: 'calm',
  supplement: 'attention',
  human_review: 'attention',
}

const STEP_MARK_ICONS: Partial<Record<ProofStepState, ReactNode>> = {
  pass: <Check size={13} strokeWidth={2.25} aria-hidden="true" />,
  attention: <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" />,
  failed: <X size={13} strokeWidth={2.25} aria-hidden="true" />,
  running: (
    <LoaderCircle size={13} strokeWidth={1.75} aria-hidden="true" className="ecoproof__spin" />
  ),
}

/** Stage results keyed for lookup; duplicate keys keep the first entry. */
function stepsByKey(steps: ProofStep[]) {
  const byKey = new Map<string, ProofStep>()
  for (const step of steps) {
    if (STAGES.some((stage) => stage.key === step.key) && !byKey.has(step.key)) {
      byKey.set(step.key, step)
    }
  }
  return byKey
}

/**
 * Read-only EcoProof evidence card for visitors. It renders what the parent
 * passes: no timers, no fetching, and no results of its own. Failed or stale
 * runs keep every completed stage and its evidence visible.
 */
export function VisitorProofCard({
  runState,
  stale = false,
  steps,
  conclusion,
  model,
  startedAt,
  finishedAt,
  busy = false,
  error,
  onStart,
  onRetry,
}: VisitorProofCardProps) {
  const running = busy || runState === 'running'
  const byKey = stepsByKey(steps)
  const rows = STAGES.map((stage) => ({ stage, step: byKey.get(stage.key) }))
  const finished = runState === 'succeeded' || runState === 'partial'
  const showConclusion = conclusion !== null && conclusion !== undefined && finished
  const tone = conclusion ? CONCLUSION_TONES[conclusion.kind] : 'accent'

  const canStart = runState === 'idle' && !running && !!onStart
  const canRetry =
    !running &&
    !!onRetry &&
    (runState === 'failed' || runState === 'partial' || (stale && finished))
  const hasEvidence = rows.some(({ step }) => (step?.evidence.length ?? 0) > 0)
  const runMeta = [
    startedAt ? `分析开始 ${formatTime(startedAt)}` : '',
    finishedAt ? `分析完成 ${formatTime(finishedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={`ecoproof ecoproof--${tone}`}
      aria-label="生态线索证据分析"
      aria-busy={running || undefined}
    >
      <header className="ecoproof__head">
        <span className="ecoproof__eyebrow">ECOPROOF · 生态线索证据</span>
        <span className={`ecoproof__run ecoproof__run--${runState}`}>
          {RUN_STATE_LABELS[runState]}
        </span>
      </header>

      {showConclusion && (
        <section className="ecoproof__conclusion" aria-label="处置建议">
          <p className="ecoproof__conclusion-kind">{CONCLUSION_LABELS[conclusion.kind]}</p>
          {conclusion.reason && <p className="ecoproof__conclusion-reason">{conclusion.reason}</p>}
        </section>
      )}

      {stale && (
        <p className="ecoproof__band ecoproof__band--stale" role="note">
          这份分析已经过期，现场情况可能已有变化。
        </p>
      )}

      {(error || runState === 'failed') && !running && (
        <div className="ecoproof__band ecoproof__band--error" role="alert">
          <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>{error || '这次分析没有完成，已经完成的检查结果仍然保留。'}</span>
        </div>
      )}

      {running && (
        <p className="ecoproof__band ecoproof__band--running" role="status">
          <LoaderCircle size={15} strokeWidth={1.75} aria-hidden="true" className="ecoproof__spin" />
          正在分析这份线索，请稍候。
        </p>
      )}

      <ol className="ecoproof__stages">
        {rows.map(({ stage, step }) => {
          const state: ProofStepState = step?.state ?? 'idle'
          return (
            <li key={stage.key} className={`ecoproof__stage ecoproof__stage--${state}`}>
              <span className={`ecoproof__mark ecoproof__mark--${state}`} aria-hidden="true">
                {STEP_MARK_ICONS[state]}
              </span>
              <div className="ecoproof__stage-body">
                <div className="ecoproof__stage-head">
                  <h4 className="ecoproof__stage-title">{stage.title}</h4>
                  <span className={`ecoproof__chip ecoproof__chip--${state}`}>
                    {STEP_STATE_LABELS[state]}
                  </span>
                </div>
                <p className="ecoproof__stage-message">{step?.message || stage.waiting}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {(canStart || canRetry) && (
        <div className="ecoproof__actions">
          {canStart && (
            <button type="button" className="ecoproof__action" onClick={onStart}>
              开始分析
            </button>
          )}
          {canRetry && (
            <button type="button" className="ecoproof__action ecoproof__action--quiet" onClick={onRetry}>
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
              重新分析
            </button>
          )}
        </div>
      )}

      {hasEvidence && (
        <details className="ecoproof__details">
          <summary>详细依据</summary>
          {rows.map(({ stage, step }) =>
            (step?.evidence.length ?? 0) > 0 ? (
              <section key={stage.key} className="ecoproof__group">
                <h5 className="ecoproof__group-title">{stage.title}</h5>
                <dl className="ecoproof__evidence">
                  {step?.evidence.map((item, index) => (
                    <div
                      key={`${stage.key}-${index}`}
                      className={`ecoproof__fact ecoproof__fact--${item.source}`}
                    >
                      <dt className="ecoproof__fact-label">{item.label}</dt>
                      <dd className="ecoproof__fact-value">{item.value}</dd>
                      <dd className="ecoproof__fact-source">{SOURCE_LABELS[item.source]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null,
          )}
        </details>
      )}

      <footer className="ecoproof__foot">
        <span className="ecoproof__model">{model || '模型信息未记录'}</span>
        <span className="ecoproof__time mono">{runMeta || '时间待记录'}</span>
      </footer>
    </article>
  )
}
