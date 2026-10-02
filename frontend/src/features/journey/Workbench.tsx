import { useEffect, useState } from "react";
import {
  api,
  type Action,
  type Event,
  type EventStatus,
  STATUS_LABELS,
} from "../../api/client";
import { AiEventCard } from "../visitor/AiEventCard";
import { JourneyHeader, JourneyFooter } from "./Journey";
import { dateLabel } from "./scenes";

/** A real administrator workbench completes the visitor's environmental care flow. */
export function Workbench() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem("gonghu.admin") || "";
    } catch {
      return "";
    }
  });
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<EventStatus | "">("");
  const [selected, setSelected] = useState<Event>();
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [photo, setPhoto] = useState<File>();
  const credentials = { adminToken: token };
  async function load() {
    try {
      const data = await api.events(credentials, {
        status: filter || undefined,
        limit: 20,
        offset,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }
  useEffect(() => {
    if (token) void load();
  }, [token, filter, offset]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api.login(username, password);
      setToken(session.access_token);
      setPassword("");
      try {
        sessionStorage.setItem("gonghu.admin", session.access_token);
      } catch {
        /* The active session still works. */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  async function action(action: Action["action"]) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const body: Action = { action, note, assignee, description: "" };
      if (action === "submit_resolution") {
        if (!photo) throw Error("请上传处理后照片");
        body.resolution_images = [await api.upload(photo)];
      }
      const updated = await api.action(selected.id, body, credentials);
      setSelected(updated);
      setNote("");
      setPhoto(undefined);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理失败");
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      setSelected(
        await api.analyze(
          selected.id,
          selected.status === "pending_acceptance" ? "resolution" : "report",
          credentials,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 分析未完成");
      try {
        setSelected(await api.event(selected.id, credentials));
      } catch {
        // Keep the last server record visible if the connection is also unavailable.
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="journey-page">
      <JourneyHeader />
      <main className="paper-page workbench">
        <span className="eyebrow">CARE CONTINUES HERE</span>
        <h1>景区接力工作台</h1>
        <p className="page-intro">
          把游客的善意，变成一次有记录的照看。审核、派单、整改、验收，每一步都有回音。
        </p>
        {error && (
          <p className="journal-error" role="alert">
            {error}
          </p>
        )}
        {!token ? (
          <form className="recover-form" onSubmit={login}>
            <h2>工作人员登录</h2>
            <label>
              账号
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label>
              密码
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="journal-submit" disabled={busy}>
              {busy ? "登录中…" : "打开工作台 ↗"}
            </button>
            <small>使用本地环境配置中的管理账号。</small>
          </form>
        ) : (
          <>
            <div className="workbench-toolbar">
              <label>
                处理阶段{" "}
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value as EventStatus | "");
                    setOffset(0);
                  }}
                >
                  <option value="">全部</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <span>共 {total} 条线索</span>
              <button className="ink-link" onClick={load}>
                刷新
              </button>
              <button
                className="ink-link"
                onClick={async () => {
                  try {
                    await api.logout(credentials);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "服务暂不可用，已退出本地会话。",
                    );
                  } finally {
                    setToken("");
                    try {
                      sessionStorage.setItem("gonghu.admin", "");
                    } catch {
                      /* No persistent session. */
                    }
                  }
                }}
              >
                退出
              </button>
            </div>
            <div className="workbench-layout">
              <aside className="workbench-list">
                {!items.length && <p>这个阶段暂无待办。</p>}
                {items.map((e) => (
                  <button
                    key={e.id}
                    className={selected?.id === e.id ? "selected" : ""}
                    onClick={() => {
                      setSelected(e);
                      setNote("");
                      setAssignee(e.assignee || "");
                      setError("");
                    }}
                  >
                    <img src={e.original_images[0]?.url} alt="线索照片" />
                    <span>
                      <small>
                        {STATUS_LABELS[e.status]} ·{" "}
                        {e.is_demo ? "演示" : "实际"}
                      </small>
                      <strong>{e.description || "一份环境关注"}</strong>
                      <time>{dateLabel(e.created_at)}</time>
                    </span>
                  </button>
                ))}
                <div className="pager">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    上一页
                  </button>
                  <button
                    disabled={offset + 20 >= total}
                    onClick={() => setOffset(offset + 20)}
                  >
                    下一页
                  </button>
                </div>
              </aside>
              <section>
                {selected ? (
                  <>
                    <AiEventCard
                      event={selected}
                      pointName={
                        selected.scenic_id === "terracotta-demo"
                          ? "兵马俑示范区"
                          : "秦岭示范区"
                      }
                      onRetry={
                        ["needs_info", "pending_review"].includes(
                          selected.status,
                        )
                          ? analyze
                          : undefined
                      }
                      retrying={busy}
                    />
                    <div className="action-sheet">
                      <h2>接力处理</h2>
                      <label>
                        处理说明
                        <textarea
                          rows={3}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      {selected.status === "pending_review" && (
                        <label>
                          责任人
                          <input
                            value={assignee}
                            onChange={(e) => setAssignee(e.target.value)}
                            disabled={busy}
                          />
                        </label>
                      )}
                      {selected.status === "processing" && (
                        <label>
                          处理后照片
                          <input
                            key={selected.id + selected.status}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => setPhoto(e.target.files?.[0])}
                            disabled={busy}
                          />
                        </label>
                      )}
                      <div className="action-buttons">
                        {selected.status === "pending_review" && (
                          <>
                            <button
                              disabled={busy || !assignee}
                              onClick={() => action("assign")}
                            >
                              审核通过并派单
                            </button>
                            <button
                              disabled={busy || !note}
                              onClick={() => action("request_info")}
                            >
                              请游客补充
                            </button>
                          </>
                        )}
                        {["pending_review", "needs_info"].includes(
                          selected.status,
                        ) && (
                          <button
                            disabled={busy || !note}
                            onClick={() => action("reject")}
                          >
                            说明后归档
                          </button>
                        )}
                        {selected.status === "processing" && (
                          <button
                            disabled={busy || !photo || !note}
                            onClick={() => action("submit_resolution")}
                          >
                            提交整改与照片
                          </button>
                        )}
                        {selected.status === "pending_acceptance" && (
                          <>
                            <button disabled={busy} onClick={analyze}>
                              AI 对比前后照片
                            </button>
                            <button
                              disabled={busy || !note}
                              onClick={() => action("close")}
                            >
                              人工验收并结案
                            </button>
                            <button
                              disabled={busy || !note}
                              onClick={() => action("return")}
                            >
                              退回继续照看
                            </button>
                          </>
                        )}
                      </div>
                      {selected.resolution_images.length > 0 && (
                        <div className="comparison">
                          <div>
                            <small>照看前</small>
                            <img
                              src={selected.original_images[0].url}
                              alt="照看前"
                            />
                          </div>
                          <div>
                            <small>照看后</small>
                            <img
                              src={selected.resolution_images[0].url}
                              alt="照看后"
                            />
                          </div>
                        </div>
                      )}
                      {selected.analyses
                        .filter(
                          (a) =>
                            a.kind === "resolution" &&
                            a.status === "succeeded" &&
                            !a.stale,
                        )
                        .slice(-1)
                        .map((a) => (
                          <div key={a.id}>
                            <h3>AI 整改对比意见</h3>
                            {a.result &&
                              "acceptance_recommendation" in a.result && (
                                <p>{a.result.acceptance_recommendation}</p>
                              )}
                          </div>
                        ))}
                      <ol className="admin-timeline">
                        {selected.timeline.map((t) => (
                          <li key={t.id}>
                            {dateLabel(t.created_at)} · {t.note || t.action}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                ) : (
                  <div className="empty-journal">
                    <h2>从一份关注开始。</h2>
                    <p>选择左侧线索，查看照片、AI 意见与处理进程。</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      <JourneyFooter />
    </div>
  );
}
