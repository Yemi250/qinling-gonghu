import { formatTime } from '../../components/format'
import type { SharedCaseFeedbackProps } from './types'
import './ecoproof.css'

/**
 * Merged-case echo for visitors. It renders only the summary the parent passes
 * — never other visitors' photos or descriptions — and returns null when there
 * is no summary at all, so no empty card can appear.
 */
export function SharedCaseFeedback({
  caseCode,
  statusLabel,
  pointName,
  submissionCount = 0,
  uniqueImageCount = 0,
  duplicateImageCount = 0,
  milestones,
  closedAt = null,
  closingNote = null,
}: SharedCaseFeedbackProps) {
  const rows = milestones ?? []
  const closed = Boolean(closedAt || closingNote)
  const hasSummary = Boolean(
    caseCode ||
      statusLabel ||
      closed ||
      rows.length > 0 ||
      submissionCount > 0 ||
      uniqueImageCount > 0 ||
      duplicateImageCount > 0,
  )
  if (!hasSummary) return null

  return (
    <section className="ecoproof-share" aria-label="关联治理回音">
      <header className="ecoproof-share__head">
        <span className="ecoproof-share__eyebrow">关联治理 · 共同的回音</span>
        {caseCode && <span className="ecoproof-share__code mono">{caseCode}</span>}
      </header>

      <p className="ecoproof-share__lead">
        {closed ? '这份共同的关注，已经有了回音。' : statusLabel ? `目前进展：${statusLabel}。` : '这条线索正在与其他投稿共同处理。'}
      </p>

      <dl className="ecoproof-share__counts">
        <div className="ecoproof-share__count">
          <dt>关联投稿</dt>
          <dd className="mono">{submissionCount}</dd>
        </div>
        <div className="ecoproof-share__count">
          <dt>不同图片</dt>
          <dd className="mono">{uniqueImageCount}</dd>
        </div>
        <div className="ecoproof-share__count">
          <dt>重复照片</dt>
          <dd className="mono">{duplicateImageCount}</dd>
        </div>
      </dl>

      {pointName && <p className="ecoproof-share__point">点位 · {pointName}</p>}

      {rows.length > 0 && (
        <ol className="ecoproof-share__milestones">
          {rows.map((milestone, index) => (
            <li key={`${milestone.label}-${index}`} className="ecoproof-share__milestone">
              <span className="ecoproof-share__milestone-time mono">
                {formatTime(milestone.createdAt)}
              </span>
              <div className="ecoproof-share__milestone-body">
                <strong>{milestone.label}</strong>
                {milestone.note && <p>{milestone.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {closed && (
        <div className="ecoproof-share__closing">
          {closingNote && <p className="ecoproof-share__closing-note">{closingNote}</p>}
          {closedAt && (
            <small className="ecoproof-share__closing-time mono">
              结案于 {formatTime(closedAt)}
            </small>
          )}
        </div>
      )}
    </section>
  )
}
