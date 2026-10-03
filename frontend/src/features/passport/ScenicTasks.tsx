import { useState } from "react";
import { api } from "../../api/client";
import type { Scene } from "../journey/scenes";
import { useVisitor } from "./VisitorProvider";

const titles: Record<string,string> = {terracotta:"陶土留影",taibai:"山风手记",huashan:"云海一刻",baotashan:"延河回忆",hanzhong:"花田来信",zhenbeitai:"边塞一页"};
/** Three quiet journeys use real account progress without inventing a physical visit. */
export function ScenicTasks({scene,onMemory,onCare}: {scene:Scene;onMemory:()=>void;onCare:()=>void}) {
  const visitor = useVisitor();
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const progress=visitor.passport?.scenes.find(s=>s.scenic_id===scene.scenicId);
  async function explore() {
    setBusy(true);setError("");
    try {visitor.acceptPassport(await api.explore(scene.scenicId));}
    catch(e){setError(e instanceof Error?e.message:"印记暂未保存，请重试");}
    finally{setBusy(false);}
  }
  const tasks = progress?.tasks ?? [
    {key:"explore",label:"翻开这一程",state:"idle"},
    {key:"memory",label:"留住一刻风景",state:"idle"},
    {key:"care",label:"为风景留份关注 · 可选",state:"idle"},
  ];
  return <section className="passport-task-sheet" aria-label={`${scene.name}本程任务`}>
    <div className="passport-task-title"><span>本程任务笺</span><h3>{titles[scene.slug]}</h3><small>慢慢探索，也顺手照看。</small></div>
    <ol>{tasks.map((task,index)=><li key={task.key} className={task.state}>
      <span className="passport-task-dot">{task.state==="completed"?"✓":String(index+1).padStart(2,"0")}</span>
      <div><strong>{task.label}</strong><p>{task.key==="explore"?"领取线上探索印记，翻开这处风景。":task.key==="memory"?"收藏一张属于你的旅途明信片。":"遇到需要照看的地方再参与，审核后留下共护印记。"}</p><small>{!visitor.user?"登录后记录进度":!visitor.passport?"正在读取进度":task.state==="completed"?"已完成":task.state==="running"?"进行中 · 等待审核或回音":"未开始"}</small></div>
      <button className="ink-link" disabled={busy || (task.key==="explore" && progress?.explored)} onClick={()=>{
        if(task.key==="explore")visitor.requestLogin(()=>void explore());
        else if(task.key==="memory")onMemory();else onCare();
      }}>{task.key==="explore"?(progress?.explored?"已探索":busy?"留印中…":"领取印记"):task.key==="memory"?"留一页":"一起照看"}<span aria-hidden="true"> ↗</span></button>
    </li>)}</ol>
    {(error||visitor.passportError) && <p role="alert" className="journal-error">{error||visitor.passportError} <button className="ink-link" onClick={()=>void visitor.refreshPassport()}>重新读取进度</button></p>}
    <p className="passport-task-foot">线上印记记录探索，不代表实地到访。无需为了任务寻找问题。</p>
  </section>;
}
