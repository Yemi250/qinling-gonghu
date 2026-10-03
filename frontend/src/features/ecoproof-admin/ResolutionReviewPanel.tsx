import { useId, useState } from "react";
import {
  CircleAlert,
  ImageOff,
  RotateCcw,
  ScanEye,
  TriangleAlert,
} from "lucide-react";
import { formatTime } from "../../components/format";
import type {
  ResolutionReviewPanelProps,
  ReviewImage,
  ReviewSuggestion,
} from "./types";
import "./ecoproof-admin.css";

const SUGGESTION_META: Record<
  ReviewSuggestion,
  { label: string; tone: "accept" | "reject" | "human" }
> = {
  recommend_accept: { label: "建议通过", tone: "accept" },
  recommend_reject: { label: "建议退回", tone: "reject" },
  need_human: { label: "无法确认，需要人工判断", tone: "human" },
};

/**
 * 整改核验面板：整改前后照片并列，附模型意见与人工验收入口。
 * 模型意见仅供参考；结案与退回只向父组件提交意图，权限与状态校验在后端。
 */
export function ResolutionReviewPanel({
  beforeImages,
  afterImages,
  beforeTotal,
  review,
  sameImage,
  stale,
  busy,
  error,
  model,
  finishedAt,
  onAnalyze,
  onClose,
  onReturn,
}: ResolutionReviewPanelProps) {
  const headingId = useId();
  const [note, setNote] = useState("");
  const noteReady = note.trim().length > 0;

  // 核验范围：提供了 reviewedImageIds 就逐张对号；缺省时视为展示的材料全部送入。
  const reviewedIds = review?.reviewedImageIds;
  const reviewedSet = reviewedIds ? new Set(reviewedIds) : null;
  const beforeReviewed = reviewedSet
    ? beforeImages.filter((i) => reviewedSet.has(i.id)).length
    : beforeImages.length;
  const afterReviewed = reviewedSet
    ? afterImages.filter((i) => reviewedSet.has(i.id)).length
    : afterImages.length;
  const beforeShort = beforeImages.length < beforeTotal;

  const suggestion =
    review && !sameImage ? SUGGESTION_META[review.suggestion] : null;

  return (
    <section
      className="ecoproof-panel"
      aria-labelledby={headingId}
      aria-busy={busy}
    >
      <header className="ecoproof-head">
        <span className="ecoproof-eyebrow">RESOLUTION REVIEW</span>
        <h3 id={headingId} className="ecoproof-title">
          <ScanEye size={17} strokeWidth={1.5} aria-hidden="true" />
          整改核验
        </h3>
        <p className="ecoproof-hint">
          左边是上报时的照片，右边是整改后提交的照片。模型意见仅供参考，是否结案由管理员决定。
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
          材料已变化，需要重新核验。下面保留的旧结论仅供对照。
        </p>
      )}

      <div className="ecoproof-compare">
        <ImageColumn
          label="照看前"
          images={beforeImages}
          total={beforeTotal}
          reviewedSet={reviewedSet}
          emptyText="暂无整改前照片。"
        />
        <ImageColumn
          label="照看后"
          images={afterImages}
          total={afterImages.length}
          reviewedSet={reviewedSet}
          emptyText="暂无整改后照片。"
        />
      </div>

      <p className="ecoproof-scope">
        {review
          ? `本次核验材料：整改前照片 ${beforeReviewed} 张、整改后照片 ${afterReviewed} 张${
              reviewedSet
                ? `（送入模型 ${beforeReviewed + afterReviewed} / 展示 ${
                    beforeImages.length + afterImages.length
                  } 张）`
                : ""
            }。`
          : "还没有核验结果；发起核验后，将把上面展示的照片送入模型。"}
      </p>
      {beforeShort && (
        <p className="ecoproof-scope-warn" role="status">
          整改前照片共 {beforeTotal} 张，此处仅包含 {beforeImages.length}{" "}
          张。未包含的照片不在本次核验范围内，结论不能代表全部整改前材料。
        </p>
      )}

      {sameImage && (
        <div className="ecoproof-same-image" role="status">
          <p>
            <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
            <strong>未提供新的整改证据。</strong>
            整改前后材料一致，模型意见不适用于本次验收。请先确认责任人是否上传了整改后的照片。
          </p>
          {review && (
            <p className="ecoproof-meta ecoproof-meta--mono">
              上一次核验基于相同照片
              {model ? ` · ${model}` : ""}
              {finishedAt ? ` · ${formatTime(finishedAt)}` : ""}，其意见不作为整改证据。
            </p>
          )}
        </div>
      )}

      {suggestion && review && (
        <section className="ecoproof-review" aria-label="模型意见">
          <header className="ecoproof-review__head">
            <h4>
              AI 整改核验
              <span className="ecoproof-tag">模型意见 · 仅供参考</span>
            </h4>
            <p
              className={`ecoproof-verdict ecoproof-verdict--${suggestion.tone}`}
            >
              {suggestion.label}
            </p>
          </header>
          <ReviewList label="可见变化" lines={review.visibleChanges} />
          <ReviewList label="仍需照看" lines={review.remainingIssues} />
          <ReviewList label="还不确定" lines={review.uncertainties} />
          <footer className="ecoproof-review__foot">
            <span className="ecoproof-meta ecoproof-meta--mono">
              {model ?? "模型未记录"} ·{" "}
              {finishedAt ? formatTime(finishedAt) : "完成时间未记录"}
            </span>
            <button
              type="button"
              className="ecoproof-btn ecoproof-btn--mist ecoproof-btn--small"
              onClick={onAnalyze}
              disabled={busy}
            >
              <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
              重新核验
            </button>
          </footer>
        </section>
      )}

      {!review && !sameImage && (
        <div className="ecoproof-no-review">
          <p>还没有模型核验结果。可以先发起核验，也可以直接在下方人工验收。</p>
          <button
            type="button"
            className="ecoproof-btn ecoproof-btn--mist"
            onClick={onAnalyze}
            disabled={busy}
          >
            <ScanEye size={14} strokeWidth={1.75} aria-hidden="true" />
            发起 AI 核验
          </button>
        </div>
      )}

      <section className="ecoproof-human" aria-label="人工验收">
        <h4>
          人工验收
          <span className="ecoproof-tag ecoproof-tag--clay">最终决定</span>
        </h4>
        <label className="ecoproof-field">
          处理说明（结案与退回都需要填写）
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="ecoproof-actions">
          <button
            type="button"
            className="ecoproof-btn"
            onClick={() => onClose(note.trim())}
            disabled={busy || !noteReady}
          >
            人工验收并结案
          </button>
          <button
            type="button"
            className="ecoproof-btn ecoproof-btn--ghost"
            onClick={() => onReturn(note.trim())}
            disabled={busy || !noteReady}
          >
            退回继续照看
          </button>
        </div>
        <p className="ecoproof-meta">
          两个动作都会记录到事件时间线；最终权限与状态校验在服务端完成。
        </p>
      </section>
    </section>
  );
}

type ImageColumnProps = {
  label: string;
  images: ReviewImage[];
  total: number;
  reviewedSet: Set<string> | null;
  emptyText: string;
};

function ImageColumn({
  label,
  images,
  total,
  reviewedSet,
  emptyText,
}: ImageColumnProps) {
  return (
    <div className="ecoproof-col">
      <h5 className="ecoproof-col__label">
        {label}
        <span className="ecoproof-meta ecoproof-meta--mono">
          {images.length}/{total} 张
        </span>
      </h5>
      {images.length === 0 ? (
        <p className="ecoproof-col__empty">
          <ImageOff size={16} strokeWidth={1.5} aria-hidden="true" />
          {emptyText}
        </p>
      ) : (
        <div
          className={`ecoproof-gallery${
            images.length > 1 ? " ecoproof-gallery--multi" : ""
          }`}
        >
          {images.map((img) => {
            const unreviewed = reviewedSet ? !reviewedSet.has(img.id) : false;
            return (
              <figure key={img.id} className="ecoproof-plate">
                <img src={img.url} alt={img.alt} loading="lazy" />
                {unreviewed && (
                  <figcaption className="ecoproof-plate__tag">
                    未送入核验
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ReviewListProps = {
  label: string;
  lines: string[];
};

function ReviewList({ label, lines }: ReviewListProps) {
  if (lines.length === 0) return null;
  return (
    <section className="ecoproof-review__section">
      <h5 className="ecoproof-label">{label}</h5>
      <ul className="ecoproof-list">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
