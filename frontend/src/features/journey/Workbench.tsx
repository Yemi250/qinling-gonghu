import { useEffect, useRef, useState } from "react";
import {
  api,
  type Action,
  type Event,
  type EventStatus,
  type Associations,
  type Overview,
  type ContributionStatus,
  STATUS_LABELS,
} from "../../api/client";
import { AiEventCard } from "../visitor/AiEventCard";
import { VisitorProofCard } from "../ecoproof";
import { CaseMergePanel, ResolutionReviewPanel } from "../ecoproof-admin";
import "./journey-upgrade.css";
import { JourneyHeader, JourneyFooter } from "./Journey";
import { dateLabel, scenicName, SCENES } from "./scenes";
import { usePointNames } from "./usePointNames";

/** A real administrator workbench completes the visitor's environmental care flow. */
export function Workbench() {
  const pointName = usePointNames();
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
  const [scenic, setScenic] = useState("");
  const [point, setPoint] = useState("");
  const [overview, setOverview] = useState<Overview>();
  const [summaryError, setSummaryError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const selectionVersion = useRef(0);
  const [selected, setSelected] = useState<Event>();
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [photo, setPhoto] = useState<File>();
  const [associations, setAssociations] = useState<Associations>();
  const [associationError, setAssociationError] = useState("");
  const [contribution, setContribution] = useState<ContributionStatus>();
  const [contributionError, setContributionError] = useState("");
  const [contributionNote, setContributionNote] = useState("");
  const credentials = { adminToken: token };
  /** Scope changes invalidate reads and clear drafts to prevent acting on the previous case. */
  function clearSelection() {
    requestVersion.current += 1;
    selectionVersion.current += 1;
    setSelected(undefined); setAssociations(undefined); setAssociationError("");
    setNote(""); setAssignee(""); setPhoto(undefined); setError("");
    setItems([]); setTotal(0);
  }
  /** Destination counters are independent of list filters; late pages cannot overwrite a new scope. */
  async function load() {
    const version = ++requestVersion.current;
    setLoading(true); setError("");
    try {
      const [page, summary] = await Promise.allSettled([
        api.events(credentials, {
          status: filter || undefined, scenic_id: scenic || undefined,
          point_id: point || undefined, limit: 20, offset,
        }), api.overview(),
      ]);
      if (version !== requestVersion.current) return;
      if (page.status === "fulfilled") {
        setItems(page.value.items); setTotal(page.value.total);
      } else {
        setItems([]); setTotal(0);
        setError(page.reason instanceof Error ? page.reason.message : "读取失败");
      }
      if (summary.status === "fulfilled") {
        setOverview(summary.value); setSummaryError("");
      } else { setSummaryError("景区待处理统计暂不可用，请刷新重试。"); }
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : "读取失败");
    } finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    if (token) void load();
    return () => { requestVersion.current += 1; };
  }, [token, filter, scenic, point, offset]);
  /** Ignore linked-material responses if the operator has selected another scope or case. */
  async function openLinkedEvent(id: string) {
    const version = ++selectionVersion.current;
    setError(""); setNote(""); setPhoto(undefined);
    try {
      const next = await api.event(id, credentials);
      if (version === selectionVersion.current) {
        setSelected(next); setAssignee(next.assignee || "");
      }
    } catch (e) {
      if (version === selectionVersion.current)
        setError(e instanceof Error ? e.message : "读取失败");
    }
  }
  useEffect(() => {
    if (!token || !selected) return;
    let live = true;
    setAssociations(undefined);
    setAssociationError("");
    api.associations(selected.id, credentials).then(data => {
      if (live) setAssociations(data);
    }).catch(e => { if (live) setAssociationError(e.message); });
    return () => { live = false; };
  }, [token, selected?.id, selected?.revision, selected?.proof?.status]);
  useEffect(()=>{
    let live=true;setContribution(undefined);setContributionError("");setContributionNote("");
    if(token&&selected)api.contribution(selected.id,credentials).then(result=>{if(live)setContribution(result);}).catch(e=>{if(live)setContributionError(e.message);});
    return()=>{live=false;};
  },[token,selected?.id,selected?.revision,selected?.relationship_version]);
  /** Review each contribution independently from association and the case's treatment state. */
  async function reviewContribution(decision:"accepted"|"rejected") {
    if(!selected||busy||!contributionNote.trim())return;
    setBusy(true);setContributionError("");
    try {
      await api.reviewContribution(selected.id,{decision,note:contributionNote,revision:selected.revision},credentials);
      setSelected(await api.event(selected.id,credentials));
      void load();
    } catch(e) {setContributionError(e instanceof Error?e.message:"贡献审核暂未保存");}
    finally{setBusy(false);}
  }
  useEffect(() => {
    if (!token || !selected || selected.proof?.status !== "running") return;
    let live = true;
    let fetching = false;
    const timer = window.setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await api.event(selected.id, credentials);
        if (live) {
          setSelected(next);
          if (next.proof?.status !== "running") void load();
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "读取阶段失败");
      } finally { fetching = false; }
    }, 1000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token, selected?.id, selected?.proof?.status]);
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
  async function action(action: Action["action"], actionNote = note) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const body: Action = { action, note: actionNote, assignee, description: "" };
      if (action === "submit_resolution") {
        if (!photo) throw Error("请上传处理后照片");
        body.resolution_images = [await api.upload(photo, credentials)];
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
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      if (selected.status === "pending_acceptance") {
        setSelected(await api.analyze(selected.id, "resolution", credentials));
      } else {
        await api.proof(selected.id, credentials);
        setSelected(await api.event(selected.id, credentials));
      }
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
  async function changeAssociation(targetId?: string, targetVersion?: number) {
    if (!selected || busy) return;
    const candidate = associations?.candidates.find(c => c.id === targetId);
    setBusy(true);
    setError("");
    try {
      const next = targetId && targetVersion ? await api.merge(selected.id, {
        target_event_id: targetId, source_revision: selected.revision,
        target_revision: targetVersion,
        reason: `管理员查看关联依据后确认：${candidate?.reasons.join("；") || "人工复核"}`,
      }, credentials) : await api.unmerge(selected.id, {
        relationship_version: selected.relationship_version, reason: "管理员复核后撤销归并",
      }, credentials);
      setSelected(next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "关联处理失败");
      try { setSelected(await api.event(selected.id, credentials)); } catch { /* Retain materials. */ }
    } finally { setBusy(false); }
  }
  const runBusy = busy || selected?.proof?.status === "running";
  const canAnalyze = !!selected && !selected.merged_into &&
    ["pending_review", "needs_info"].includes(selected.status);
  const reviewRun = selected?.analyses.filter(a => a.kind === "resolution").slice(-1)[0];
  const reviewResult = reviewRun?.result && "acceptance_recommendation" in reviewRun.result
    ? reviewRun.result : null;
  const reviewedAfter = reviewRun?.input_snapshot?.resolution_images;
  const reviewedAfterIds = Array.isArray(reviewedAfter) ? reviewedAfter.flatMap((i: unknown) =>
    i && typeof i === "object" && "id" in i && typeof i.id === "string" ? [i.id] : []) : [];
  const destinations = [{ scenicId: "", name: "全部景区" }, ...Object.values(SCENES)];
  const availablePoints = (overview?.points ?? []).filter(p =>
    p.availability === "demo" && (!scenic || p.scenic_id === scenic));
  const scopeName = scenic ? scenicName(scenic) : "全部景区";
  /** Count open governance roots, without treating duplicate submissions as separate work. */
  function pendingCount(id: string): number | null {
    if (!overview || summaryError) return null;
    if (!id) return Object.entries(overview.by_status)
      .filter(([status]) => !["closed", "rejected"].includes(status))
      .reduce((sum, [, count]) => sum + count, 0);
    return overview.points.filter(p => p.scenic_id === id)
      .reduce((sum, p) => sum + p.pending_count, 0);
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
            <div className="workbench-scenic-heading">
              <h2>按景区接力</h2><p>数字为待处理治理事件，重复投稿归并后只计一件。</p>
            </div>
            <nav className="workbench-scenic-nav" aria-label="按景区查看治理事件">
              {destinations.map(destination => {
                const count = pendingCount(destination.scenicId);
                return <button key={destination.scenicId} type="button"
                  aria-pressed={scenic === destination.scenicId} disabled={busy}
                  aria-label={`${destination.name}，待处理 ${count ?? "暂不可用"} 件`}
                  onClick={() => {
                    if (scenic === destination.scenicId) return;
                    clearSelection(); setScenic(destination.scenicId); setPoint(""); setOffset(0);
                  }}>
                  <span>{destination.name}</span><span className="workbench-scenic-count" aria-hidden="true">{count ?? "—"}</span>
                </button>;
              })}
            </nav>
            {summaryError && <p className="notebook-fine" role="status">{summaryError}</p>}
            <div className="workbench-toolbar">
              <label>具体点位{" "}
                <select value={point} disabled={busy || !overview}
                  onChange={e => { clearSelection(); setPoint(e.target.value); setOffset(0); }}>
                  <option value="">全部点位</option>
                  {availablePoints.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>
                处理阶段{" "}
                <select
                  value={filter}
                  disabled={busy}
                  onChange={(e) => {
                    clearSelection();
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
              <span role="status">{loading ? "正在读取事件…" : `${scopeName} · 共 ${total} 件治理事件`}</span>
              <button className="ink-link" onClick={load} disabled={busy || loading}>
                刷新
              </button>
              <button
                className="ink-link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.logout(credentials);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "服务暂不可用，已退出本地会话。",
                    );
                  } finally {
                    clearSelection(); setOverview(undefined); setLoading(false); setBusy(false);
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
                {!items.length && <p>{loading ? "正在读取这处景区的关注…" : error ? "事件未能读取，请刷新重试。" : "当前景区和筛选条件下暂无治理事件。"}</p>}
                {items.map((e) => (
                  <button
                    key={e.id}
                    className={selected?.id === e.id ? "selected" : ""}
                    disabled={busy || loading}
                    onClick={() => {
                      selectionVersion.current += 1;
                      setSelected(e);
                      setNote("");
                      setAssignee(e.assignee || "");
                      setPhoto(undefined);
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
                      <small>{pointName(e.point_id, scenicName(e.scenic_id))}</small>
                      {e.governance && <small>{e.governance.submission_count} 份关联投稿 · {e.governance.unique_image_count} 张不同图片</small>}
                      <time>{dateLabel(e.created_at)}</time>
                    </span>
                  </button>
                ))}
                <div className="pager">
                  <button
                    disabled={busy || loading || offset === 0}
                    onClick={() => { clearSelection(); setOffset(Math.max(0, offset - 20)); }}
                  >
                    上一页
                  </button>
                  <button
                    disabled={busy || loading || offset + 20 >= total}
                    onClick={() => { clearSelection(); setOffset(offset + 20); }}
                  >
                    下一页
                  </button>
                </div>
              </aside>
              <section>
                {selected ? (
                  <>
                    <VisitorProofCard
                      runState={selected.proof?.status ?? "idle"}
                      stale={selected.proof?.stale ?? false}
                      steps={(selected.proof?.steps ?? []).map(s => ({ ...s, evidence: s.evidence ?? [] }))}
                      conclusion={selected.proof?.conclusion ?? null}
                      model={selected.proof?.model ?? null}
                      startedAt={selected.proof?.started_at ?? null}
                      finishedAt={selected.proof?.finished_at ?? null}
                      busy={runBusy} error={selected.proof?.error ?? (error || null)}
                      onStart={canAnalyze ? analyze : undefined}
                      onRetry={canAnalyze ? analyze : undefined}
                    />
                    <AiEventCard
                      event={selected}
                      pointName={pointName(selected.point_id, scenicName(selected.scenic_id))}
                      retrying={runBusy}
                    />
                    <CaseMergePanel
                      key={`merge-${selected.id}`}
                      candidates={(associations?.candidates ?? []).filter(c => !c.stale).map(c => ({
                        id: c.id, title: c.title, pointName: pointName(c.point_id, scenicName(selected.scenic_id)), createdAt: c.created_at,
                        version: c.version, relation: c.relation, reasons: c.reasons,
                        uncertainties: c.uncertainties, submissionCount: c.submission_count,
                        uniqueImageCount: c.unique_image_count,
                      }))}
                      currentSummary={selected.merged_into ? {
                        targetEventId: selected.merged_into,
                        reasons: selected.timeline.filter(t => t.action === "merged").slice(-1).map(t => t.note),
                      } : null}
                      relationshipVersion={selected.relationship_version}
                      busy={runBusy} error={associationError || error || null}
                      stale={!selected.merged_into && (!!associations?.stale || !associations)}
                      onMerge={(id, version) => void changeAssociation(id, version)}
                      onUndo={() => void changeAssociation()}
                    />
                    {associations && <div className="case-materials">
                      {associations.candidates.filter(c => !c.stale).map(c => <details key={c.id}>
                        <summary>查看候选 QL-{c.id.slice(0, 8).toUpperCase()} 的图片依据</summary>
                        <div className="case-photo-grid">{c.images.map(i => <img key={i.id} src={i.url} alt="候选线索材料" />)}</div>
                      </details>)}
                      {associations.members.length > 1 && <>
                        <h3>共同治理材料 · {associations.members.length} 份投稿</h3>
                        {associations.members.map(member => <details key={member.id}>
                          <summary>投稿 QL-{member.id.slice(0, 8).toUpperCase()} · {member.description || "环境关注"}</summary>
                          <div className="case-photo-grid">{member.original_images.map(i => <img key={i.id} src={i.url} alt="关联投稿材料，仅工作人员可见" />)}</div>
                          <button className="ink-link" disabled={runBusy} onClick={() => void openLinkedEvent(member.id)}>查看这份投稿与关联 ↗</button>
                        </details>)}
                      </>}
                    </div>}
                    <section className="passport-contribution" aria-label="有效贡献审核">
                      <h3>让有效的关注，留下共护印记。</h3>
                      {contribution?<>
                        <p>贡献审核：{contribution.decision==="accepted"?"已确认有效":contribution.decision==="rejected"?"不计为有效贡献":"待逐份确认"} · {contribution.valid?"满足共护奖励条件":"当前不满足共护奖励条件"}</p>
                        <p>{!contribution.independent?"这份投稿使用了已提交过的照片，不作为独立图片贡献，也不重复奖励。":!contribution.account_record?"此为旧匿名记录，导入游客护照后再核对奖励。":selected.merged_into?"关联成功不等于有效贡献，请逐份查看材料并确认。":"根投稿审核通过并派单可记为有效贡献；审核纠正会同步调整守护值。"}</p>
                        {contribution.note&&<p>最近依据：{contribution.note}</p>}
                        <label className="journal-field">本次贡献审核说明<textarea value={contributionNote} maxLength={4000} onChange={e=>setContributionNote(e.target.value)} disabled={runBusy}/></label>
                        <div className="passport-contribution-actions"><button className="ink-link" disabled={runBusy||!contributionNote.trim()||!contribution.independent} onClick={()=>void reviewContribution("accepted")}>确认有效贡献</button><button className="ink-link" disabled={runBusy||!contributionNote.trim()} onClick={()=>void reviewContribution("rejected")}>不计为有效贡献 / 纠正审核</button></div>
                      </>:<p>{contributionError||"正在读取贡献条件…"}</p>}
                      {contributionError&&contribution&&<p role="alert" className="journal-error">{contributionError}</p>}
                    </section>
                    {selected.merged_into && <button className="ink-link" disabled={runBusy} onClick={() => void openLinkedEvent(selected.merged_into!)}>前往主事件接力处理 ↗</button>}
                    {!selected.merged_into && <div className="action-sheet">
                      <h2>接力处理</h2>
                      {selected.status !== "pending_acceptance" && <label>
                        处理说明
                        <textarea
                          rows={3}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          disabled={busy}
                        />
                      </label>}
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
                      </div>
                      {selected.resolution_images.length > 0 && <fieldset
                        className="case-review-frame" disabled={selected.status !== "pending_acceptance"}>
                        <ResolutionReviewPanel
                          key={`review-${selected.id}`}
                          beforeImages={(associations?.before_images ?? selected.original_images).map(i => ({ ...i, alt: "整改前材料" }))}
                          afterImages={selected.resolution_images.map(i => ({ ...i, alt: "整改后材料" }))}
                          beforeTotal={associations?.before_total ?? selected.original_images.length}
                          review={reviewResult ? {
                            suggestion: reviewResult.suggestion ?? "need_human",
                            visibleChanges: reviewResult.visible_changes,
                            remainingIssues: reviewResult.remaining_issues,
                            uncertainties: reviewResult.uncertainties,
                            reviewedImageIds: reviewResult.same_image ? [] : [
                              ...(reviewResult.reviewed_images ?? []).map(i => i.id),
                              ...reviewedAfterIds,
                            ],
                          } : null}
                          sameImage={reviewResult?.same_image ?? false}
                          stale={reviewRun?.stale ?? false}
                          busy={busy} error={error || null}
                          model={reviewResult?.same_image ? null : reviewRun?.model ?? null}
                          finishedAt={reviewRun?.finished_at ?? null}
                          onAnalyze={() => void analyze()}
                          onClose={n => void action("close", n)}
                          onReturn={n => void action("return", n)}
                        />
                        {reviewResult && <p className="notebook-fine">{reviewResult.acceptance_recommendation}</p>}
                      </fieldset>}
                      <ol className="admin-timeline">
                        {selected.timeline.map((t) => (
                          <li key={t.id}>
                            {dateLabel(t.created_at)} · {t.note || t.action}
                          </li>
                        ))}
                      </ol>
                    </div>}
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
