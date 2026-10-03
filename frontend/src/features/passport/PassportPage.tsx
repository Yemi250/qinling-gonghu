import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, STATUS_LABELS, type EventStatus, type PersonalRecord } from "../../api/client";
import { JourneyHeader, JourneyFooter } from "../journey/Journey";
import { SCENES, dateLabel, readReceipts, scenicName } from "../journey/scenes";
import { BadgeArt } from "./BadgeArt";
import { useVisitor } from "./VisitorProvider";

type Tab = "journey" | "memory" | "care" | "badges";
/** A private, server-backed passport replaces the device-only receipt index. */
export function PassportPage() {
  const visitor=useVisitor();
  const [tab,setTab]=useState<Tab>("journey");const [scenic,setScenic]=useState("");const [offset,setOffset]=useState(0);
  const [records,setRecords]=useState<{key:string;items:PersonalRecord[];total:number}>();
  const [history,setHistory]=useState<Awaited<ReturnType<typeof api.visitorRewards>>>();
  const [historyOffset,setHistoryOffset]=useState(0);const [historyOwner,setHistoryOwner]=useState("");
  const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const [importing,setImporting]=useState(false);const [importMessage,setImportMessage]=useState("");
  const key=`${visitor.user?.id}:${tab}:${scenic}:${offset}`;
  const activeRecords=records?.key===key?records:undefined;
  const legacy=readReceipts().filter(r=>r.token);
  useEffect(()=>{
    let live=true;setError("");setImportMessage("");
    if(!visitor.user)return;
    if(tab==="memory"||tab==="care"){
      setLoading(true);
      api.visitorRecords({kind:tab,scenic_id:scenic||undefined,offset}).then(data=>{
        if(live)setRecords({key,items:data.items,total:data.total});
      }).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});
    }
    if(tab==="badges")api.visitorRewards(historyOffset).then(data=>{if(live){setHistory(data);setHistoryOwner(visitor.user!.id);}}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[key,historyOffset]);
  useEffect(()=>{setTab("journey");setScenic("");setOffset(0);setHistoryOffset(0);setHistory(undefined);setRecords(undefined);setError("");setImportMessage("");},[visitor.user?.id]);
  async function importLegacy() {
    setImporting(true);setImportMessage("");
    try{
      const results=[];
      for(let start=0;start<legacy.length;start+=50)results.push(...await api.importRecords(legacy.slice(start,start+50).map(r=>({id:r.id,kind:r.kind,query_token:r.token}))));
      const imported=results.filter(r=>r.imported).length;
      setImportMessage(`已导入 ${imported} 条；${results.length-imported} 条凭证无效或已有归属，未导入。`);
      await visitor.refreshPassport();
    }catch(e){setImportMessage(e instanceof Error?e.message:"暂时未能导入，请重试");}
    finally{setImporting(false);}
  }
  const passport=visitor.passport;
  return <div className="journey-page journey-framed passport-shell"><div className="journey-canvas"><JourneyHeader immersive/><main className="paper-page passport-page">
    {!visitor.ready?<p role="status">正在翻开护照…</p>:!visitor.user?<section className="passport-welcome">
      <span className="eyebrow">一本只属于你的山河护照</span><h1>让每一程，<br/>都有迹可循。</h1>
      <p>收藏遇见的风景，接收善意的回音。<br/>探索印记与共护勋章，跟着你的账号同行。</p>
      <div className="passport-welcome-medals"><BadgeArt id="departure"/><BadgeArt id="guardian"/><BadgeArt id="echo"/></div>
      <button className="journal-submit" onClick={()=>visitor.requestLogin()}>注册或登录，翻开我的护照</button>
      <Link className="ink-link" to="/care/recover">用旧编号和凭证找回匿名记录 ↗</Link>
    </section>:<>
      <div className="passport-cover"><div><span className="eyebrow">{visitor.user.nickname} / 山河护照</span><h1>我的足迹</h1><p>走过线上山河，也留下真实的善意。</p></div>
        <div className="passport-value"><strong>{passport?.summary.guardian_value??"—"}</strong><span>守护值</span><small>探索与共护参与的成长记录</small></div></div>
      <div className="passport-account-line"><span>@{visitor.user.username} · 记录随账号同步，照片不公开展示</span><button className="ink-link" onClick={()=>void visitor.refreshPassport()}>刷新护照</button><button className="ink-link" onClick={()=>void visitor.logout()}>退出游客账号</button></div>
      <nav className="passport-tabs" aria-label="护照内容">{([["journey","我的旅程"],["memory","风景记忆"],["care","共护回音"],["badges","勋章册"]] as const).map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setOffset(0);setScenic("");}}>{label}</button>)}</nav>
      {(error||visitor.passportError)&&<p className="journal-error" role="alert">{error||visitor.passportError}</p>}
      {tab==="journey"&&<>
        <div className="passport-stat-grid"><div><strong>{passport?.summary.explored_count??"—"}<small> / 6</small></strong><span>已探索篇章</span></div><div><strong>{passport?.summary.memory_count??"—"}</strong><span>风景记忆</span></div><div><strong>{passport?.summary.valid_contribution_count??"—"}</strong><span>有效共护贡献</span></div><div><strong>{passport?.summary.closed_case_count??"—"}</strong><span>已有结案回音</span></div></div>
        <h2>你的山河，慢慢展开。</h2><div className="passport-scene-grid">{Object.values(SCENES).map(scene=>{
          const progress=passport?.scenes.find(s=>s.scenic_id===scene.scenicId);
          const next=progress?.tasks.find(task=>task.state!=="completed");
          return <Link key={scene.slug} to={`/scenic/${scene.slug}`} className={`passport-scene-stamp ${progress?.explored?"explored":""}`}><img src={`assets/${scene.landmarkImage}`} alt=""/><div><small>{scene.city} / {progress?.explored?"已探索":"等待翻开"}</small><h3>{scene.name}</h3><p>{passport?next?.label??"本程任务已有记录":"正在读取任务进度…"}</p></div><span aria-hidden="true">↗</span></Link>;
        })}</div>
        <p className="notebook-fine">探索印记来自线上参与，不代表实际到访。共护是可选的，遇到需要照看的地方再行动。</p>
        {legacy.length>0&&<div className="passport-import"><h3>这个浏览器还有 {legacy.length} 条旧凭证</h3><p>确认这些旧匿名记录属于你，再将可导入的记录绑定到当前护照。已有归属的记录不会转移。</p><button className="ink-link" disabled={importing} onClick={()=>void importLegacy()}>{importing?"正在核对旧凭证…":"导入我的护照 ↗"}</button>{importMessage&&<p role="status">{importMessage}</p>}</div>}
      </>}
      {(tab==="memory"||tab==="care")&&<>
        <div className="passport-record-filter"><label>记录景区 <select value={scenic} onChange={e=>{setScenic(e.target.value);setOffset(0);}}><option value="">全部景区</option>{Object.values(SCENES).map(s=><option key={s.scenicId} value={s.scenicId}>{s.name}</option>)}</select></label><span>{loading?"正在读取这一页…":`共 ${activeRecords?.total??0} 条记录`}</span></div>
        <div className="footprint-grid">{activeRecords?.items.map(r=><Link key={r.id} to={`/${r.kind}/${r.id}`} className="footprint-card"><img src={r.image} alt={r.title||"我的风景记录"}/><span className="eyebrow">{scenicName(r.scenic_id)}{r.status?` / ${STATUS_LABELS[r.status as EventStatus]}`:" / 私密收藏"}</span><h2>{r.title||"有些风景，值得再看一次。"}</h2><small>{dateLabel(r.created_at)}</small><span aria-hidden="true">↗</span></Link>)}</div>
        {!loading&&!error&&!activeRecords?.items.length&&<div className="empty-journal"><h2>{tab==="memory"?"第一张风景，等你收藏。":"有需要照看的地方，再留下关注。"}</h2><Link className="ink-link" to="/">去山河里走走 ↗</Link></div>}
        <div className="pager"><button disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>上一页</button><button disabled={loading||offset+20>=(activeRecords?.total??0)} onClick={()=>setOffset(offset+20)}>下一页</button></div>
      </>}
      {tab==="badges"&&<>
        <p className="passport-badge-intro">每枚印记，都有一段可以说清的来由。</p><div className="passport-badge-grid">{passport?.badges.map(b=><article key={b.id} className={b.earned?"passport-badge earned":"passport-badge"}><BadgeArt id={b.id} earned={b.earned}/><h2>{b.name}</h2><p>{b.condition}</p><progress value={b.progress} max={b.target} aria-label={`${b.name}解锁进度`}/><small>{b.earned?`已解锁 · ${dateLabel(b.earned_at!)}`:`${b.progress} / ${b.target} · 尚未解锁`}</small></article>)}</div>
        <details className="passport-reward-history"><summary>守护值明细与参与规则</summary><p>每景区探索 +5，首次独立风景记忆 +10；人工审核的有效共护每事件 +20。重复照片不重复奖励，关联或贡献审核纠正后会保留调整明细。守护值不代表治理成效，不用于兑换。</p>
          {historyOwner===visitor.user.id&&history?.items.map(change=><div key={change.id}><span>{change.label}<small>{change.note} · {dateLabel(change.created_at)}</small></span><strong>{change.delta>0?"+":""}{change.delta}</strong></div>)}
          <div className="pager"><button disabled={historyOffset===0} onClick={()=>setHistoryOffset(Math.max(0,historyOffset-20))}>上一页明细</button><button disabled={historyOffset+20>=(history?.total??0)} onClick={()=>setHistoryOffset(historyOffset+20)}>下一页明细</button></div>
        </details>
      </>}
      <Link className="ink-link receipt-recover" to="/care/recover">用编号和凭证找回旧匿名共护记录 ↗</Link>
    </>}
  </main><JourneyFooter/></div></div>;
}
