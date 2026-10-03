import { useEffect, useId, useState } from "react";
import { CircleAlert, GitMerge, Link2Off, TriangleAlert } from "lucide-react";
import { eventCode, formatTime } from "../../components/format";
import type {
  CaseMergePanelProps,
  MergeCandidate,
  MergeRelation,
} from "./types";
import "./ecoproof-admin.css";

const RELATION_LABELS: Record<MergeRelation, string> = {
  same_issue: "同一问题",
  different: "不同问题",
  uncertain: "无法确定",
};

/** 确认区的关系提示：只转述模型结论，判断留给管理员。 */
const RELATION_NOTES: Record<MergeRelation, string> = {
  same_issue: "模型判断两条线索指向同一问题。",
  different: "模型判断两条线索是不同问题，归并前请务必人工复核。",
  uncertain: "模型无法确定是否同一问题，请对照两边照片后再决定。",
};

/**
 * 线索归并面板：展示模型提出的归并候选与已有归并，管理员先选择、再确认。
 * 纯展示组件——数据、异步结果和业务规则都由父组件与后端负责。
 */
export function CaseMergePanel({
  candidates,
  currentSummary,
  relationshipVersion,
  busy,
  error,
  stale,
  onMerge,
  onUndo,
}: CaseMergePanelProps) {
  const headingId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const candidateKey = candidates.map((c) => c.id).join("|");
  // 候选集合变化（刷新、归并成功）后，旧的选择不再可靠，交还管理员重新选。
  useEffect(() => {
    setSelectedId(null);
  }, [candidateKey]);

  const actionsDisabled = busy || stale;
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const onlyUncertain =
    candidates.length > 0 &&
    candidates.every((c) => c.relation === "uncertain");

  return (
    <section
      className="ecoproof-panel"
      aria-labelledby={headingId}
      aria-busy={busy}
    >
      <header className="ecoproof-head">
        <span className="ecoproof-eyebrow">CASE MERGE</span>
        <h3 id={headingId} className="ecoproof-title">
          <GitMerge size={17} strokeWidth={1.5} aria-hidden="true" />
          线索归并
        </h3>
        <p className="ecoproof-hint">
          同一点位近期完全重复、且符合处置条件的照片可由系统归并；不同照片的关联建议，需要管理员对照材料后确认。
        </p>
      </header>

      {error && (
        <p className="ecoproof-error" role="alert">
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}

      {stale && (
        <p className="ecoproof-stale" role="status">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          线索关系已经变化，以下候选可能过期。请先刷新确认，再执行归并或撤销。
        </p>
      )}

      {currentSummary && (
        <section className="ecoproof-merged">
          <h4>已有归并</h4>
          <p>
            当前线索已并入事件{" "}
            <code className="ecoproof-code">
              {eventCode(currentSummary.targetEventId)}
            </code>
            {currentSummary.targetTitle ? `「${currentSummary.targetTitle}」` : ""}
            {currentSummary.targetPointName
              ? ` · ${currentSummary.targetPointName}`
              : ""}
            。
          </p>
          {currentSummary.reasons && currentSummary.reasons.length > 0 && (
            <>
              <h5>归并依据</h5>
              <ul className="ecoproof-list">
                {currentSummary.reasons.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          <p className="ecoproof-meta ecoproof-meta--mono">
            关系版本 v{relationshipVersion}
            {currentSummary.mergedAt
              ? ` · ${formatTime(currentSummary.mergedAt)} 归并`
              : ""}
          </p>
          <button
            type="button"
            className="ecoproof-btn ecoproof-btn--ghost"
            onClick={() => onUndo(relationshipVersion)}
            disabled={actionsDisabled}
          >
            <Link2Off size={14} strokeWidth={1.75} aria-hidden="true" />
            撤销这次归并
          </button>
        </section>
      )}

      {candidates.length === 0 ? (
        <div className="ecoproof-empty">
          <p>暂无可供确认的归并候选。已关联的投稿仍保留原始材料和记录。</p>
        </div>
      ) : (
        <>
          {onlyUncertain && (
            <p className="ecoproof-note" role="status">
              本轮没有判定为“同一问题”的候选，以下都需要人工判断。
            </p>
          )}
          <div
            className="ecoproof-candidates"
            role="radiogroup"
            aria-label="选择要归并的候选事件"
          >
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                selected={c.id === selectedId}
                disabled={actionsDisabled}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>

          {selected && (
            <div className="ecoproof-confirm" role="group" aria-label="确认归并">
              <p>
                已选择「{selected.title}」。{RELATION_NOTES[selected.relation]}
              </p>
              <p className="ecoproof-meta ecoproof-meta--mono">
                拟并入事件{" "}
                <code className="ecoproof-code">{eventCode(selected.id)}</code> ·
                按该事件当前版本 v{selected.version} 提交
              </p>
              <div className="ecoproof-actions">
                <button
                  type="button"
                  className="ecoproof-btn"
                  onClick={() => onMerge(selected.id, selected.version)}
                  disabled={actionsDisabled}
                >
                  确认归并
                </button>
                <button
                  type="button"
                  className="ecoproof-btn ecoproof-btn--ghost"
                  onClick={() => setSelectedId(null)}
                  disabled={busy}
                >
                  取消选择
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type CandidateCardProps = {
  candidate: MergeCandidate;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
};

function CandidateCard({
  candidate: c,
  selected,
  disabled,
  onSelect,
}: CandidateCardProps) {
  return (
    <div className={`ecoproof-candidate${selected ? " is-selected" : ""}`}>
      <label className="ecoproof-candidate__pick">
        <input
          type="radio"
          name="ecoproof-merge-target"
          value={c.id}
          checked={selected}
          onChange={onSelect}
          disabled={disabled}
        />
        <span className="ecoproof-candidate__top">
          <strong className="ecoproof-candidate__title">{c.title}</strong>
          <span className={`ecoproof-relation ecoproof-relation--${c.relation}`}>
            {RELATION_LABELS[c.relation]}
          </span>
        </span>
        <span className="ecoproof-meta ecoproof-meta--mono">
          {c.pointName} · {formatTime(c.createdAt)} 上报
        </span>
        <span className="ecoproof-meta">
          关联投稿 {c.submissionCount} 次 · 不同图片 {c.uniqueImageCount} 张 ·
          拟并入 <code className="ecoproof-code">{eventCode(c.id)}</code>
        </span>
      </label>
      <div className="ecoproof-candidate__detail">
        {c.reasons.length > 0 && (
          <>
            <h5 className="ecoproof-label">关联依据</h5>
            <ul className="ecoproof-list">
              {c.reasons.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
        {c.uncertainties.length > 0 && (
          <>
            <h5 className="ecoproof-label">不确定项</h5>
            <ul className="ecoproof-list ecoproof-list--caution">
              {c.uncertainties.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
