import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Camera,
  Feather,
  Heart,
  MapPin,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Atlas } from "./Atlas";
import { Notebook } from "./Notebook";
import { SCENES, readReceipts, dateLabel } from "./scenes";
import "./journey.css";
import "./home-atlas.css";
import "./scenic-chapters.css";
import { useVisitor } from "../passport/VisitorProvider";
import { ScenicExploration } from "../passport/ScenicTasks";

/** A quiet navigation layer shared by the atlas and themed scenic chapters. */
export function JourneyHeader({ immersive = false }: { immersive?: boolean }) {
  const visitor = useVisitor();
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  return (
    <header className={`journey-header${immersive ? " immersive" : ""}`}>
      <Link className="journey-brand" to="/">
        <svg
          className="brand-mountains"
          viewBox="0 0 100 42"
          aria-hidden="true"
        >
          <path
            d="M3 34 17 28 29 16 37 22 49 7 58 13 65 23 74 17 88 29 98 34 75 33 61 28 48 32 32 30 16 35Z"
            fill="currentColor"
          />
          <path
            d="m19 29 10-9 6 6 14-14 7 5 7 12-13-8-10 10-10-4-11 5m44-1 11-8 9 10-10-5-6 5"
            fill="#f7f2e6"
            opacity=".85"
          />
          <path
            d="M4 37q15-5 25-3t24-1q21-4 43 4"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            opacity=".6"
          />
        </svg>
        <span>秦岭共护</span>
      </Link>
      <nav aria-label="主导航">
        <NavLink
          to="/"
          end
          className={
            pathname === "/" ||
            (pathname.startsWith("/scenic/") && pathname !== "/scenic/taibai")
              ? "active"
              : ""
          }
        >
          陕西漫游
        </NavLink>
        <NavLink to="/scenic/taibai">秦岭专栏</NavLink>
        <NavLink to="/footprints">我的足迹</NavLink>
      </nav>
      {(
        <div className="header-tools">
          <button
            aria-label="寻找一处风景"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={23} strokeWidth={1.6} />
          </button>
          <span className="header-tools-rule" />
          {visitor.user ? <Link className="passport-header-user" to="/footprints" aria-label={`查看${visitor.user.nickname}的护照`}>
            <UserRound size={23} strokeWidth={1.6} />
            <span>{visitor.user.nickname}</span>
          </Link> : <button className="passport-header-user" disabled={!visitor.ready} onClick={()=>visitor.requestLogin()} aria-label="注册或登录游客账号"><UserRound size={23} strokeWidth={1.6}/><span>{visitor.ready?"登录 / 注册":"读取中"}</span></button>}
        </div>
      )}
      {searchOpen && (
        <section
          className="destination-search"
          aria-label="寻找风景"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearchOpen(false);
          }}
        >
          <div>
            <label className="visually-hidden" htmlFor="destination-search">
              景区名称
            </label>
            <input
              autoFocus
              id="destination-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="寻找一处风景"
            />
            <button
              aria-label="关闭风景搜索"
              onClick={() => setSearchOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          {Object.values(SCENES)
            .filter((s) => (s.name + s.city).includes(search.trim()))
            .map((s) => (
              <Link
                to={`/scenic/${s.slug}`}
                key={s.slug}
                onClick={() => setSearchOpen(false)}
              >
                {s.name}
                <small>{s.city} · 体验篇章</small>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          {!Object.values(SCENES).some((s) =>
            (s.name + s.city).includes(search.trim()),
          ) && <p>暂时没有找到这处风景，试试景区名或城市名。</p>}
        </section>
      )}
    </header>
  );
}
export function JourneyFooter() {
  return (
    <footer className="journey-footer">
      <span>把风景留在心里，也留给后来的人。</span>
      <span>
        体验原型 · 景区尚未正式接入 <Link to="/workbench">景区工作台 ↗</Link>
      </span>
    </footer>
  );
}
/** Start with geography and destination exploration, rather than a dashboard. */
export function JourneyHome() {
  return (
    <div className="journey-page journey-framed journey-home">
      <div className="journey-canvas">
        <JourneyHeader immersive />
        <main className="atlas-main">
          <div className="atlas-heading">
            <h1>从一处风景开始</h1>
            <p>
              行走三秦大地，
              <br />
              在山河之间，遇见历史，也遇见更好的未来。
            </p>
          </div>
          <Atlas />
          <span className="atlas-proportion">山河示意 · 非实际比例</span>
          <Link className="home-workbench" to="/workbench">
            景区工作台 ↗
          </Link>
        </main>
      </div>
    </div>
  );
}
/** Each scenic chapter changes color, scenery and copy while keeping interaction consistent. */
export function ScenicPage() {
  const visitor = useVisitor();
  const { slug } = useParams();
  const scene = SCENES[slug as keyof typeof SCENES];
  const [mode, setMode] = useState<"memory" | "care" | null>(null);
  useEffect(() => {
    setMode(null);
  }, [slug]);
  useEffect(()=>{
    const logout=()=>setMode(null);
    window.addEventListener("gonghu:visitor-logout",logout);
    return()=>window.removeEventListener("gonghu:visitor-logout",logout);
  },[]);
  /** Open the requested notebook only after an account is ready, without losing the destination. */
  function participate(next: "memory" | "care") { visitor.requestLogin(()=>setMode(next)); }
  if (!scene)
    return (
      <div className="journey-page">
        <JourneyHeader />
        <main className="paper-page">
          <h1>这一程还在筹备</h1>
          <Link to="/">返回陕西漫游</Link>
        </main>
      </div>
    );
  return (
    <div
      className={`journey-page journey-framed scene-page scene--${scene.palette}`}
    >
      <div className="journey-canvas">
        <JourneyHeader immersive />
        <main>
          <section
            className="scene-hero"
            style={{ backgroundImage: `url(assets/${scene.image}.png)` }}
          >
            <Link className="scene-back" to="/">
              <ArrowLeft size={16} /> 回到山河地图
            </Link>
            <div className="scene-story">
              <h1>
                {scene.title.split("，")[0]}，<br />
                {scene.title.split("，")[1]}
              </h1>
              <p>{scene.description}</p>
            </div>
            <span className="scene-location">
              <MapPin size={15} />
              {scene.city} · {scene.name} <small>视觉意境图</small>
            </span>
            <div className="scene-bottom-fade" />
          </section>
          <section className="scene-notes">
            <div className="scene-invitation">
              <span className="eyebrow">YOUR LITTLE FIELD JOURNAL</span>
              <h2>
                这一程，
                <br />
                值得被好好记住。
              </h2>
              <p>
                翻开随行手记，收藏一个瞬间，
                <br />
                或者为风景做一件小事。
              </p>
              <span className="handwritten">来过，也照看过。</span>
            </div>
            <div className="field-journal">
              <span className="journal-spine" />
              <span className="journal-topline">
                {scene.name} / 随行手记 <BookOpen size={17} />
              </span>
              <button
                className="journal-choice"
                onClick={() => participate("memory")}
              >
                <Camera strokeWidth={1.2} size={30} />
                <span>
                  <strong>留住这一刻</strong>
                  <small>一张照片，一段只属于你的风景记忆</small>
                </span>
                <ArrowUpRight size={20} />
              </button>
              <button
                className="journal-choice"
                onClick={() => participate("care")}
              >
                <Heart strokeWidth={1.2} size={30} />
                <span>
                  <strong>一起照看这里</strong>
                  <small>记录需要关注的地方，让景区接力处理</small>
                </span>
                <ArrowUpRight size={20} />
              </button>
              <ScenicExploration scene={scene}/>
              <div className="journal-foot">
                <Feather size={15} />
                <span>你的善意，会有回音。</span>
                <span className="journal-stamp">山河共护</span>
              </div>
            </div>
          </section>
        </main>
        <JourneyFooter />
      </div>
      {mode && (
        <Notebook scene={scene} mode={mode} close={() => setMode(null)} />
      )}
    </div>
  );
}
/** The local index links to private, persisted memories and environmental receipts. */
export function Footprints() {
  const receipts = readReceipts();
  return (
    <div className="journey-page">
      <JourneyHeader />
      <main className="paper-page">
        <span className="eyebrow">MY LITTLE JOURNEY</span>
        <h1>我的足迹</h1>
        <p className="page-intro">
          来过的风景，做过的小事，都在这里。本机保存访问凭证，内容不会公开展示。
        </p>
        {!receipts.length ? (
          <div className="empty-journal">
            <Feather size={38} strokeWidth={1} />
            <h2>第一页，等你来写。</h2>
            <Link className="ink-link" to="/">
              去山河里走走 <ArrowUpRight size={18} />
            </Link>
          </div>
        ) : (
          <div className="footprint-grid">
            {receipts.map((r) => (
              <Link
                key={r.id}
                to={`/${r.kind}/${r.id}`}
                className="footprint-card"
              >
                <img src={r.image} alt={r.title} />
                <span className="eyebrow">
                  {r.kind === "memory" ? "风景记忆" : "共护回音"} / {r.scenic}
                </span>
                <h2>{r.title}</h2>
                <small>{dateLabel(r.date)}</small>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
        )}
        <Link className="ink-link receipt-recover" to="/care/recover">
          用编号和凭证找回共护记录 ↗
        </Link>
      </main>
      <JourneyFooter />
    </div>
  );
}
