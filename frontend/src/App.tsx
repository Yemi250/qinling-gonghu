import { useEffect, useState } from "react";
import { api, type Overview } from "./api/client";

// C provides a minimal integration entry. A owns the eventual shared visual design.
export function App() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.overview().then((value) => { if (active) setOverview(value); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  return <main style={{ maxWidth: 800, margin: "64px auto", padding: 24, fontFamily: "system-ui", lineHeight: 1.8 }}>
    <p>秦岭共护 · 团队联调入口</p>
    <h1>让每一次发现，都有一个回应。</h1>
    <p>业务后端已接入。游客页面、管理页面和图像识别模块由 A / B / D 接入。</p>
    {error ? <p role="alert">{error}</p> : overview
      ? <p>已保存 {overview.total} 条记录，其中演示数据 {overview.demo_count} 条，已结案 {overview.closed_count} 条。</p>
      : <p role="status">正在读取真实记录统计…</p>}
    <a href="/docs">打开 API 交互文档</a>
  </main>;
}
