import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, Feather, LoaderCircle, RefreshCw } from "lucide-react";
import {
  api,
  STATUS_LABELS,
  type Event,
  type Postcard,
} from "../../api/client";
import { AiEventCard } from "../visitor/AiEventCard";
import { JourneyHeader, JourneyFooter } from "./Journey";
import { readReceipts, dateLabel, saveReceipt, type Receipt } from "./scenes";

/** Look up scoped credentials without embedding secrets in URLs. */
function useReceipt(kind: "memory" | "care") {
  const { id = "" } = useParams();
  const location = useLocation();
  const [receipt, setReceipt] = useState<Receipt | undefined>(
    () =>
      location.state?.receipt ||
      readReceipts().find((r) => r.id === id && r.kind === kind),
  );
  useEffect(() => {
    setReceipt(
      location.state?.receipt ||
        readReceipts().find((r) => r.id === id && r.kind === kind),
    );
  }, [id, kind, location.key]);
  return { id, receipt, setReceipt, auto: !!location.state?.startAnalysis };
}
export function MemoryPage() {
  const { id, receipt, setReceipt } = useReceipt("memory");
  const [card, setCard] = useState<Postcard>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (receipt)
      api
        .postcard(id, receipt.token)
        .then((v) => {
          if (live) setCard(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [id, receipt]);
  return (
    <div className="journey-page">
      <JourneyHeader />
      <main className="paper-page memory-page">
        <Link className="ink-link" to="/footprints">
          <ArrowLeft size={15} /> 我的足迹
        </Link>
        <span className="eyebrow">A MOMENT TO KEEP</span>
        <h1>留住这一刻</h1>
        {!receipt ? (
          <Recover kind="memory" accept={setReceipt} />
        ) : card ? (
          <article className="memory-postcard">
            <img
              src={card.images[0].url}
              alt={card.description || "旅途照片"}
            />
            <div>
              <span className="postcard-seal">
                山河
                <br />
                来信
              </span>
              <h2>{card.description || "有些风景，值得再看一次。"}</h2>
              <p>
                {receipt.scenic} · {dateLabel(card.created_at)}
              </p>
              <small>编号 {id.slice(0, 8).toUpperCase()} / 私密收藏</small>
              <Feather size={22} />
            </div>
            {receipt && <ReceiptBackup receipt={receipt} />}
          </article>
        ) : (
          <p role="status">{error || "正在翻开这一页…"}</p>
        )}
      </main>
      <JourneyFooter />
    </div>
  );
}
/** Show actual persisted AI runs and administrator actions, with explicit failure recovery. */
export function CarePage() {
  const { id, receipt, setReceipt, auto } = useReceipt("care");
  const [event, setEvent] = useState<Event>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  async function refresh() {
    if (!receipt) return;
    try {
      setEvent(await api.event(id, { queryToken: receipt.token }));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }
  async function analyze() {
    if (!receipt || busy) return;
    setBusy(true);
    setError("");
    try {
      setEvent(await api.analyze(id, "report", { queryToken: receipt.token }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析暂未完成");
      try {
        setEvent(await api.event(id, { queryToken: receipt.token }));
      } catch {
        /* Keep the last visible server record. */
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!receipt) return;
    let live = true;
    api
      .event(id, { queryToken: receipt.token })
      .then((v) => {
        if (live) setEvent(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, receipt]);
  useEffect(() => {
    if (
      auto &&
      event &&
      receipt &&
      !started.current &&
      event.ai_status.report === "not_started"
    ) {
      started.current = true;
      void analyze();
    }
  }, [auto, event, receipt]);
  return (
    <div className="journey-page">
      <JourneyHeader />
      <main className="paper-page care-page">
        <Link className="ink-link" to="/footprints">
          <ArrowLeft size={15} /> 我的足迹
        </Link>
        <span className="eyebrow">A LITTLE CARE, A REAL RESPONSE</span>
        <h1>这份善意，有回音。</h1>
        <p className="page-intro">照片已留存。AI 协助看见，景区接力照看。</p>
        {!receipt ? (
          <Recover kind="care" accept={setReceipt} />
        ) : (
          <>
            {error && (
              <p role="alert" className="journal-error">
                {error}
              </p>
            )}
            {event ? (
              <div className="care-layout">
                <AiEventCard
                  event={event}
                  pointName={receipt.scenic}
                  onRetry={
                    ["needs_info", "pending_review"].includes(event.status)
                      ? analyze
                      : undefined
                  }
                  retrying={busy}
                />
                <aside className="care-timeline">
                  <span className="eyebrow">共护进程</span>
                  <h2>{STATUS_LABELS[event.status]}</h2>
                  <p>
                    {event.assignee
                      ? `接力人：${event.assignee}`
                      : "等待景区人工查看"}
                  </p>
                  <div className="real-ai-status">
                    {busy ? (
                      <>
                        <LoaderCircle className="spin" size={17} /> AI
                        正在分析照片
                      </>
                    ) : (
                      <>编号 {event.id.slice(0, 8).toUpperCase()}</>
                    )}
                    <small>
                      {busy
                        ? "正在从照片里整理环境线索，请稍候"
                        : "分析结果与处理进程来自服务端记录"}
                    </small>
                  </div>
                  <ol>
                    {event.timeline.map((t) => (
                      <li key={t.id}>
                        <span>{dateLabel(t.created_at)}</span>
                        <strong>{t.note || t.action}</strong>
                      </li>
                    ))}
                  </ol>
                  {event.resolution_images.length > 0 && (
                    <section>
                      <h3>照看之后</h3>
                      {event.resolution_images.map((img) => (
                        <img
                          className="resolution-photo"
                          key={img.id}
                          src={img.url}
                          alt="处理后照片"
                        />
                      ))}
                      <p>{event.resolution_note}</p>
                    </section>
                  )}
                  <button
                    className="ink-link"
                    onClick={refresh}
                    disabled={busy}
                  >
                    <RefreshCw size={15} /> 查看最新回音
                  </button>
                  <p className="notebook-fine">
                    当前为演示记录，不代表已向真实景区派单。
                  </p>
                  {event.status === "needs_info" && (
                    <Supplement
                      event={event}
                      token={receipt.token}
                      updated={setEvent}
                    />
                  )}
                  <ReceiptBackup receipt={receipt} />
                </aside>
              </div>
            ) : (
              <p role="status">正在读取共护记录…</p>
            )}
          </>
        )}
      </main>
      <JourneyFooter />
    </div>
  );
}

/** Make the full receipt available for an intentional, private cross-device recovery. */
function ReceiptBackup({ receipt }: { receipt: Receipt }) {
  return (
    <details className="receipt-backup">
      <summary>保存这页的私密访问凭证</summary>
      <p className="notebook-fine">
        请抄好下面两项，换浏览器后可找回此页。持有凭证的人可以读取记录。
      </p>
      <label>
        完整记录编号
        <input readOnly value={receipt.id} onFocus={(e) => e.target.select()} />
      </label>
      <label>
        私密访问凭证
        <input
          readOnly
          value={receipt.token}
          onFocus={(e) => e.target.select()}
        />
      </label>
    </details>
  );
}
/** Restore a private record on another browser using its original receipt. */
function Recover({
  kind,
  accept,
}: {
  kind: "memory" | "care";
  accept: (r: Receipt) => void;
}) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState(id === "recover" ? "" : id);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const v =
        kind === "care"
          ? await api.event(identifier, { queryToken: token })
          : await api.postcard(identifier, token);
      const image = "images" in v ? v.images[0] : v.original_images[0];
      const r: Receipt = {
        id: identifier,
        token,
        kind,
        scenic: v.scenic_id === "terracotta-demo" ? "兵马俑" : "太白山",
        title: v.description || "我的旅途记录",
        image: image.url,
        date: v.created_at,
      };
      try {
        saveReceipt(r);
      } catch {
        /* Session access remains available when local storage is disabled. */
      }
      if (identifier !== id) {
        navigate(`/${kind}/${identifier}`, { state: { receipt: r } });
      } else accept(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "没有找到记录");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="recover-form" onSubmit={submit}>
      <h2>找回你的这一页</h2>
      <p>请输入保存时获得的编号和私密凭证。</p>
      <label>
        完整记录编号
        <input
          required
          pattern="[a-f0-9]{32}"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value.trim())}
        />
      </label>
      <label>
        私密访问凭证
        <input
          required
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value.trim())}
        />
      </label>
      {error && (
        <p role="alert" className="journal-error">
          {error}
        </p>
      )}
      <button className="journal-submit" disabled={busy}>
        {busy ? "查找中…" : "翻开这一页 ↗"}
      </button>
    </form>
  );
}

/** A visitor can provide the missing information requested by a reviewer. */
function Supplement({
  event,
  token,
  updated,
}: {
  event: Event;
  token: string;
  updated: (e: Event) => void;
}) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      updated(
        await api.action(
          event.id,
          { action: "supplement", description, note: "", assignee: "" },
          { queryToken: token },
        ),
      );
      setDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "补充失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="supplement-form" onSubmit={submit}>
      <label className="journal-field">
        补充一点现场信息
        <textarea
          maxLength={4000}
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="journal-error">
          {error}
        </p>
      )}
      <button className="journal-submit" disabled={busy || !description.trim()}>
        {busy ? "保存中…" : "把信息补充给景区"}
      </button>
    </form>
  );
}
