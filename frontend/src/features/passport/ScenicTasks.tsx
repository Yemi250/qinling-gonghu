import { useState } from "react";
import { ArrowUpRight, Compass } from "lucide-react";
import { api } from "../../api/client";
import type { Scene } from "../journey/scenes";
import { useVisitor } from "./VisitorProvider";

/** Keep exploration alongside the two notebook actions, with real account progress. */
export function ScenicExploration({scene}: {scene:Scene}) {
  const visitor = useVisitor();
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const progress=visitor.passport?.scenes.find(s=>s.scenic_id===scene.scenicId);
  async function explore() {
    setBusy(true);setError("");
    try {visitor.acceptPassport(await api.explore(scene.scenicId));}
    catch(e){setError(e instanceof Error?e.message:"印记暂未保存，请重试");}
    finally{setBusy(false);}
  }
  return <>
    <button className="journal-choice passport-exploration" aria-label={progress?.explored?"已探索":"领取印记"}
      disabled={busy || progress?.explored || (!!visitor.user && !visitor.passport)}
      onClick={()=>visitor.requestLogin(()=>void explore())}>
      <Compass strokeWidth={1.2} size={30}/>
      <span><strong>{progress?.explored?"这一程，已有印记":busy?"正在留下印记…":"领取探索印记"}</strong>
        <small>{progress?.explored?"已探索 · 印记已收入山河护照":visitor.user&&!visitor.passport?"正在读取护照…":"为线上探索留一枚印记，收入你的山河护照"}</small></span>
      <ArrowUpRight size={20}/>
    </button>
    {(error||visitor.passportError) && <p role="alert" className="journal-error passport-exploration-error">{error||visitor.passportError} <button className="ink-link" onClick={()=>void visitor.refreshPassport()}>重新读取进度</button></p>}
  </>;
}
