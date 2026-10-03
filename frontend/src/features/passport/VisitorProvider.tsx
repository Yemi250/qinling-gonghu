import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, setVisitorCsrf, type Badge, type Passport, type VisitorUser } from "../../api/client";
import { BadgeArt } from "./BadgeArt";
import "./passport.css";

type VisitorContextValue = {
  user: VisitorUser | null; ready: boolean; passport?: Passport; passportError: string;
  requestLogin: (after?: () => void, force?: boolean) => void;
  refreshPassport: () => Promise<void>; acceptPassport: (data: Passport) => void;
  logout: () => Promise<void>;
  readDraft: (key:string)=>string; writeDraft: (key:string,value:string)=>void;
};
const VisitorContext = createContext<VisitorContextValue | null>(null);
/** Account identity lives above route changes; signed-out state clears all account data. */
export function VisitorProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<VisitorUser | null>(null);
  const [ready, setReady] = useState(false);
  const [passport, setPassport] = useState<Passport>();
  const [passportError, setPassportError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [celebration, setCelebration] = useState<Badge>();
  const userRef = useRef<VisitorUser | null>(null);
  const generation = useRef(0);
  const passportVersion = useRef(0);
  const knownBadges = useRef<Set<string> | null>(null);
  const afterLogin = useRef<(() => void) | undefined>(undefined);
  const drafts = useRef(new Map<string,string>());
  const draftAccount = useRef("");
  const channel = useRef<BroadcastChannel | null>(null);
  const csrfRef = useRef<string | null>(null);
  /** Invalidate every pending account read before exposing another identity. */
  function identity(next: VisitorUser | null, csrf: string | null) {
    csrfRef.current=csrf;
    if(next && draftAccount.current!==next.id){drafts.current.clear();draftAccount.current=next.id;}
    generation.current += 1; passportVersion.current += 1; userRef.current = next; setUser(next); setVisitorCsrf(csrf);
    knownBadges.current = null; setPassport(undefined); setPassportError(""); setCelebration(undefined);
  }
  /** Animate newly earned medals only after the initial progress snapshot. */
  function acceptPassport(data: Passport) {
    passportVersion.current += 1;
    const earned = new Set(data.badges.filter(b => b.earned).map(b => b.id));
    if (knownBadges.current) setCelebration(data.badges.find(b => b.earned && !knownBadges.current!.has(b.id)));
    knownBadges.current = earned; setPassport(data); setPassportError("");
  }
  async function refreshPassport() {
    if (!userRef.current) return;
    const version = generation.current;
    const request = ++passportVersion.current;
    try {
      const data = await api.passport();
      if (version === generation.current && request === passportVersion.current && userRef.current) acceptPassport(data);
    } catch (e) {
      if (version === generation.current && request === passportVersion.current) setPassportError(e instanceof Error ? e.message : "护照暂时未能读取");
    }
  }
  function requestLogin(after?: () => void, force = false) {
    if (userRef.current && !force) { after?.(); return; }
    if (force) identity(null, null);
    afterLogin.current = after; setLoginOpen(true);
  }
  async function logout() {
    try { await api.visitorLogout(); }
    catch(e) { if(e instanceof Error && "status" in e && e.status!==401) {setPassportError("退出暂未成功，请检查网络后重试。");return;} }
    window.dispatchEvent(new Event("gonghu:visitor-logout"));
    drafts.current.clear();draftAccount.current="";
    identity(null, null);
    channel.current?.postMessage("session_changed");
  }
  useEffect(() => {
    let live = true;
    const version = generation.current;
    api.visitorMe().then(session => {
      if (live && version === generation.current) identity(session.user, session.csrf_token ?? null);
    }).catch(() => { /* Public browsing remains available during a service failure. */ })
      .finally(() => { if (live) setReady(true); });
    const expired = () => identity(null, null);
    /** Cookies are shared across tabs; re-read identity without broadcasting any credential. */
    const sync = async () => {
      const scope = generation.current;
      try {
        const session=await api.visitorMe();
        if(live && scope===generation.current && (session.user?.id!==userRef.current?.id || session.csrf_token!==csrfRef.current))identity(session.user,session.csrf_token??null);
      } catch { /* Keep the visible identity during a temporary service failure. */ }
    };
    if(typeof BroadcastChannel!=="undefined") {channel.current=new BroadcastChannel("gonghu:visitor-session");channel.current.onmessage=()=>void sync();}
    window.addEventListener("focus",sync);
    window.addEventListener("gonghu:visitor-expired", expired);
    return () => { live = false; channel.current?.close();window.removeEventListener("focus",sync);window.removeEventListener("gonghu:visitor-expired", expired); };
  }, []);
  useEffect(() => { if (user) void refreshPassport(); }, [user]);
  return <VisitorContext.Provider value={{user, ready, passport, passportError, requestLogin, refreshPassport, acceptPassport, logout, readDraft:key=>drafts.current.get(key)||"",writeDraft:(key,value)=>{drafts.current.set(key,value);}}}>
    {children}
    {loginOpen && <AuthDialog close={() => { setLoginOpen(false); afterLogin.current = undefined; }} success={(next, csrf) => {
      identity(next, csrf); channel.current?.postMessage("session_changed");setLoginOpen(false); const resume = afterLogin.current; afterLogin.current = undefined; resume?.();
    }}/>}
    {celebration && !loginOpen && <div className="passport-award" role="status">
      <BadgeArt id={celebration.id}/><div><small>山河护照 · 新的印记</small><strong>{celebration.name}</strong><span>{celebration.condition}</span></div>
      <button onClick={() => setCelebration(undefined)} aria-label="收好这枚勋章">×</button>
    </div>}
  </VisitorContext.Provider>;
}
/** Expose the single visitor session to headers, tasks, records and submission forms. */
export function useVisitor() {
  const value = useContext(VisitorContext);
  if (!value) throw new Error("VisitorProvider is required");
  return value;
}
/** A focused paper-leaf dialog preserves the surrounding scenic page and form draft. */
function AuthDialog({close, success}: {close: () => void; success: (user: VisitorUser, csrf: string | null) => void}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState(""); const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (mode === "register" && password !== confirm) {setError("两次输入的密码不一致"); return;}
    setBusy(true);
    try {
      const session = mode === "register" ? await api.visitorRegister({username, nickname, password, confirm_password:confirm}) : await api.visitorLogin(username,password);
      if (session.user) success(session.user, session.csrf_token ?? null);
    } catch(e) {setError(e instanceof Error ? e.message : "暂时未能登录");}
    finally {setBusy(false);}
  }
  return <div className="passport-auth-overlay" onMouseDown={e => {if(e.target === e.currentTarget && !busy) close();}}>
    <div className="passport-auth" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="visitor-auth-title" onKeyDown={e => {
      if(e.key === "Escape" && !busy) close();
      if(e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)");
        if(!nodes?.length) return; const first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey && document.activeElement === first) {e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement === last) {e.preventDefault();first.focus();}
      }
    }}>
      <button className="passport-auth-close" onClick={close} disabled={busy} aria-label="暂时不参与">×</button>
      <span className="eyebrow">山河护照 / 从这一页启程</span>
      <h2 id="visitor-auth-title">{mode === "register" ? "把这一程，留在你的名下。" : "欢迎回来，继续这一程。"}</h2>
      <p>收藏风景、接收共护回音，让旅途与勋章随账号同行。</p>
      <form onSubmit={submit}>
        <label>用户名<input aria-label="用户名" autoComplete="username" required pattern="[a-zA-Z0-9_]{3,32}" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/><small>3–32 位字母、数字或下划线，不区分大小写</small></label>
        {mode === "register" && <label>昵称<input aria-label="昵称" maxLength={24} value={nickname} onChange={e=>setNickname(e.target.value)} disabled={busy} placeholder="旅途中，怎么称呼你？"/></label>}
        <label>密码<input aria-label="密码" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={8} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/><small>8–128 位，请记好用户名与密码</small></label>
        {mode === "register" && <label>确认密码<input aria-label="确认密码" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={busy}/></label>}
        {error && <p role="alert" className="journal-error">{error}</p>}
        <button className="journal-submit" disabled={busy}>{busy ? "正在翻开护照…" : mode === "register" ? "注册并继续这一程" : "登录并继续这一程"}</button>
      </form>
      <button className="ink-link" disabled={busy} onClick={()=>{setMode(mode === "register" ? "login" : "register");setError("");setPassword("");setConfirm("");}}>{mode === "register" ? "已经有护照？登录" : "第一次来？注册一本护照"}</button>
    </div>
  </div>;
}
