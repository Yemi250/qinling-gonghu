import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Camera,
  Feather,
  Heart,
  MapPin,
} from "lucide-react";
import { Atlas } from "./Atlas";
import { Notebook } from "./Notebook";
import { SCENES, readReceipts, dateLabel } from "./scenes";
import { api, type Overview } from "../../api/client";
import "./journey.css";

/** A quiet navigation layer shared by the atlas and themed scenic chapters. */
export function JourneyHeader() {
  return (
    <header className="journey-header">
      <Link className="journey-brand" to="/">
        <span className="brand-seal">共</span>
        <span>
          秦岭共护<small>山河漫游 · 一起照看</small>
        </span>
      </Link>
      <nav aria-label="主导航">
        <NavLink to="/" end>
          陕西漫游
        </NavLink>
        <NavLink to="/scenic/taibai">秦岭专栏</NavLink>
        <NavLink to="/footprints">我的足迹</NavLink>
      </nav>
      <span className="header-edition">牛来 / 山河共护计划</span>
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
  const [overview, setOverview] = useState<Overview>();
  useEffect(() => {
    let live = true;
    api
      .overview()
      .then((v) => {
        if (live) setOverview(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="journey-page">
      <JourneyHeader />
      <main className="atlas-main">
        <div className="atlas-heading">
          <span className="eyebrow">SHAANXI, AT YOUR OWN PACE</span>
          <h1>
            山河有回响，
            <br />
            <em>等你来一趟。</em>
          </h1>
          <p>
            从黄土的厚重，到秦岭的清朗。
            <br />
            点亮一个地标，开启你的陕西漫游。
          </p>
        </div>
        <Atlas />
        <div className="atlas-bottom">
          <span>
            <span className="small-dot" /> 已开放 2 个体验篇章
          </span>
          <span>美景收藏 / 环境共护</span>
          <span>
            {overview
              ? `演示线索 ${overview.demo_count} 条 · 结案 ${overview.closed_count} 条`
              : "轻触地标，走进风景"}
          </span>
        </div>
      </main>
      <JourneyFooter />
    </div>
  );
}
/** Each scenic chapter changes color, scenery and copy while keeping interaction consistent. */
export function ScenicPage() {
  const { slug } = useParams();
  const scene = SCENES[slug as keyof typeof SCENES];
  const [mode, setMode] = useState<"memory" | "care" | null>(null);
  useEffect(() => {
    setMode(null);
  }, [slug]);
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
    <div className={`journey-page scene-page scene--${scene.palette}`}>
      <JourneyHeader />
      <main>
        <section
          className="scene-hero"
          style={{ backgroundImage: `url(assets/${scene.image}.png)` }}
        >
          <Link className="scene-back" to="/">
            <ArrowLeft size={16} /> 回到山河地图
          </Link>
          <div className="scene-story">
            <span className="eyebrow">{scene.eyebrow}</span>
            <h1>
              {scene.title.split("，")[0]}，<br />
              {scene.title.split("，")[1]}
            </h1>
            <p>{scene.description}</p>
            <span className="scene-coordinates">{scene.coordinate}</span>
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
              onClick={() => setMode("memory")}
            >
              <Camera strokeWidth={1.2} size={30} />
              <span>
                <strong>留住这一刻</strong>
                <small>一张照片，一段只属于你的风景记忆</small>
              </span>
              <ArrowUpRight size={20} />
            </button>
            <button className="journal-choice" onClick={() => setMode("care")}>
              <Heart strokeWidth={1.2} size={30} />
              <span>
                <strong>一起照看这里</strong>
                <small>记录需要关注的地方，让景区接力处理</small>
              </span>
              <ArrowUpRight size={20} />
            </button>
            <div className="journal-foot">
              <Feather size={15} />
              <span>你的善意，会有回音。</span>
              <span className="journal-stamp">山河共护</span>
            </div>
          </div>
        </section>
      </main>
      <JourneyFooter />
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
