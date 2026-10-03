import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Camera, Feather, LoaderCircle, X } from "lucide-react";
import { api, ApiError, type Overview } from "../../api/client";
import { type Scene, type Receipt } from "./scenes";
import { useVisitor } from "../passport/VisitorProvider";

/** Photo submission is a notebook leaf; it persists a receipt before requesting AI. */
export function Notebook({
  scene,
  mode,
  close,
}: {
  scene: Scene;
  mode: "memory" | "care";
  close: () => void;
}) {
  const navigate = useNavigate();
  const visitor = useVisitor();
  const owner = useRef(visitor.user?.id);
  const dialog = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState<Overview["points"]>([]);
  const [point, setPoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  useEffect(()=>{
    if(visitor.user && owner.current && owner.current !== visitor.user.id) {
      setFile(undefined);setDescription("");setError("已切换账号，请为当前护照重新选择照片。");
    }
    if(visitor.user)owner.current=visitor.user.id;
  },[visitor.user?.id]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = old;
      prev?.focus();
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    let live = true;
    if (mode === "care")
      api
        .overview()
        .then((data) => {
          if (!live) return;
          const list = data.points.filter(
            (p) => p.scenic_id === scene.scenicId && p.availability === "demo",
          );
          setPoints(list);
          setPoint(list[0]?.id || "");
        })
        .catch(() => {
          if (live) setError("点位暂时没有加载，请关闭手记后重试。");
        });
    return () => {
      live = false;
    };
  }, [scene, mode]);
  /** Keep focus inside the notebook, and allow Escape before a save starts. */
  function keyboard(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !busy) close();
    if (e.key === "Tab") {
      const nodes = dialog.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    if (!visitor.user) { visitor.requestLogin(()=>setError("登录已恢复，照片和文字已保留，请继续保存。")); return; }
    setBusy(true);
    setError("");
    try {
      setStep("正在保存照片与文字");
      const upload = await api.upload(file);
      let receipt: Receipt;
      if (mode === "memory") {
        const { postcard } = await api.createPostcard({
          scenic_id: scene.scenicId,
          description,
          images: [upload],
        });
        receipt = {
          id: postcard.id,
          token: "",
          kind: mode,
          scenic: scene.name,
          title: description || `${scene.name}的一刻`,
          image: postcard.images[0].url,
          date: postcard.created_at,
        };
      } else {
        const { event } = await api.createEvent({
          scenic_id: scene.scenicId,
          point_id: point,
          description,
          original_images: [upload],
          is_demo: true,
        });
        receipt = {
          id: event.id,
          token: "",
          kind: mode,
          scenic: scene.name,
          title: description || `为${scene.name}留一份关注`,
          image: event.original_images[0].url,
          date: event.created_at,
        };
      }
      void visitor.refreshPassport();
      navigate(`/${mode}/${receipt.id}`, {
        state: { startAnalysis: mode === "care" },
      });
    } catch (err) {
      if(err instanceof ApiError && (err.status===401 || err.detail.code==="invalid_csrf")) visitor.requestLogin(()=>setError("登录已恢复，照片和文字已保留，请继续保存。"));
      setError(
        err instanceof Error ? err.message : "暂时未能保存，请稍后重试。",
      );
    } finally {
      setBusy(false);
      setStep("");
    }
  }
  return (
    <div
      className="notebook-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        className="notebook-leaf"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notebook-title"
        tabIndex={-1}
        onKeyDown={keyboard}
      >
        <button
          className="notebook-close"
          aria-label="合上手记"
          disabled={busy}
          onClick={close}
        >
          <X size={21} />
        </button>
        <span className="eyebrow">{scene.name} / 随行手记</span>
        <h2 id="notebook-title">
          {mode === "memory" ? "留住这一刻" : "一起照看这里"}
        </h2>
        <p className="notebook-intro">
          {mode === "memory"
            ? "收藏一张照片，让这一程有迹可循。"
            : "一张照片、一点描述，帮助景区看见需要照看的地方。"}
        </p>
        <form onSubmit={submit}>
          <label
            className={`photo-leaf ${preview ? "has-photo" : ""}`}
            htmlFor="journal-photo"
          >
            {preview ? (
              <img src={preview} alt="选中的照片预览" />
            ) : (
              <>
                <Camera size={36} strokeWidth={1} />
                <span>把这一刻，放进手记</span>
                <small>选择 JPG / PNG / WebP · 最多 10 MB</small>
              </>
            )}
            <input
              id="journal-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 10 * 1024 * 1024) {
                  setError("照片请小于 10 MB");
                  e.target.value = "";
                  return;
                }
                setError("");
                setFile(f);
              }}
            />
            <span className="photo-edit">
              {preview ? "换一张照片" : "选一张照片"}
            </span>
          </label>
          {mode === "care" && (
            <label className="journal-field">
              在哪里发现的？
              <select
                aria-label="发现点位"
                value={point}
                onChange={(e) => setPoint(e.target.value)}
                disabled={busy}
              >
                {!points.length && <option value="">点位加载中</option>}
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="journal-field">
            {mode === "memory" ? "写一句旅途心情" : "说说你看见了什么"}
            <textarea
              rows={3}
              maxLength={120}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                mode === "memory"
                  ? "比如：午后的光，落在千年的陶土上。"
                  : "比如：休息区附近有一些散落的饮料瓶。"
              }
            />
            <span className="field-count">{description.length} / 120</span>
          </label>
          <p className="notebook-fine">
            {mode === "memory"
              ? "这是一张私密旅途明信片，不会进入治理工单。"
              : "当前为体验点位。AI 辅助整理线索，景区人工审核与派单。"}
          </p>
          {error && (
            <p className="journal-error" role="alert">
              {error}
            </p>
          )}
          {(
            <button
              type="submit"
              className="journal-submit"
              disabled={!file || busy || (mode === "care" && !point)}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Feather size={18} />
              )}{" "}
              {busy
                ? step
                : mode === "memory"
                  ? "收好这一刻"
                  : "让这份善意有回音"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
