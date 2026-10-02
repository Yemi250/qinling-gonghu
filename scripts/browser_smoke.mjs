/** Real browser + isolated HTTP server. No production AI mock and no filesystem cleanup. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { createServer } from "node:net";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.env.PYTHON_EXECUTABLE ||
  join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const data = await mkdtemp(join(tmpdir(), "gonghu-browser-"));
const evidence =
  process.env.BROWSER_ARTIFACT_DIR ||
  join(root, "data", "browser-evidence", Date.now().toString());
await mkdir(evidence, { recursive: true });
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const origin = `http://127.0.0.1:${port}`;
const password = "isolated-browser-test-only";
const runner =
  "import os; from pathlib import Path; import uvicorn; from backend.app.main import create_app; from backend.app.config import Settings; s=Settings(_env_file=None,data_dir=Path(os.environ['BROWSER_DATA']),demo_admin_password=os.environ['BROWSER_PASSWORD'],ai_api_key=''); uvicorn.run(create_app(s),host='127.0.0.1',port=int(os.environ['BROWSER_PORT']),access_log=False)";
const server = spawn(python, ["-c", runner], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    AI_API_KEY: "",
    BROWSER_DATA: data,
    BROWSER_PASSWORD: password,
    BROWSER_PORT: String(port),
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.on("data", (chunk) => {
  serverError += chunk.toString();
});
let browser;
/** Verify a real HTTP result without printing scoped credentials. */
async function json(response, status = 200) {
  assert.equal(response.status, status);
  return response.json();
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${origin}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Server startup. */
    }
    await pause(250);
  }
  assert.ok(ready, serverError);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".city-boundaries path").count(), 10);
  const hotspot = page.getByRole("link", { name: "进入兵马俑" });
  await hotspot.hover();
  await page.screenshot({
    path: join(evidence, "01-atlas.png"),
    fullPage: true,
  });
  await hotspot.click();
  await page.waitForURL("**/#/scenic/terracotta");
  await page.screenshot({
    path: join(evidence, "02-terracotta.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "留住这一刻" }).click();
  assert.ok(await page.getByRole("dialog").isVisible());
  await page.screenshot({ path: join(evidence, "03-notebook.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "留住这一刻" }).click();
  await page
    .locator("#journal-photo")
    .setInputFiles(join(root, "frontend/public/assets/terracotta.png"));
  await page
    .getByRole("textbox", { name: "写一句旅途心情" })
    .fill("午后的光落在千年的陶土上");
  await page.getByRole("button", { name: "收好这一刻" }).click();
  await page.waitForURL("**/#/memory/*");
  await page.locator(".memory-postcard").waitFor();
  await page.reload();
  await page.locator(".memory-postcard").waitFor();
  assert.equal((await json(await fetch(`${origin}/api/overview`))).total, 0);
  await page.screenshot({
    path: join(evidence, "04-memory.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "秦岭专栏" }).click();
  await page.waitForURL("**/#/scenic/taibai");
  await page.screenshot({
    path: join(evidence, "05-taibai.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "一起照看这里" }).click();
  await page
    .locator("#journal-photo")
    .setInputFiles(join(root, "frontend/public/assets/taibai.png"));
  await page
    .getByRole("textbox", { name: "说说你看见了什么" })
    .fill("浏览器验收：休息区需要照看");
  await page.getByRole("button", { name: "让这份善意有回音" }).click();
  await page.waitForURL("**/#/care/*");
  await page.getByRole("button", { name: "重新分析" }).waitFor();
  const careURL = page.url();
  const receipts = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("gonghu.journey.receipts.v1")),
  );
  assert.equal(receipts.length, 2);
  const receipt = receipts.find((r) => r.kind === "care");
  let saved = await json(
    await fetch(`${origin}/api/events/${receipt.id}`, {
      headers: { "X-Visitor-Token": receipt.token },
    }),
  );
  assert.equal(saved.ai_status.report, "failed");
  assert.equal(saved.analyses.length, 1);
  await page.reload();
  await page.locator(".care-timeline").waitFor();
  await pause(300);
  saved = await json(
    await fetch(`${origin}/api/events/${receipt.id}`, {
      headers: { "X-Visitor-Token": receipt.token },
    }),
  );
  assert.equal(
    saved.analyses.length,
    1,
    "Refresh must not silently invoke AI again",
  );
  const admin = await context.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(`${origin}/#/workbench`);
  await admin.getByLabel("密码", { exact: true }).fill(password);
  await admin.getByRole("button", { name: "打开工作台" }).click();
  await admin.locator(".workbench-list>button").first().click();
  await admin.getByLabel("处理说明").fill("请补充具体方位");
  await admin.getByRole("button", { name: "请游客补充" }).click();
  await admin.getByRole("button", { name: "说明后归档" }).waitFor();
  await page.getByRole("button", { name: "查看最新回音" }).click();
  await page
    .getByRole("textbox", { name: "补充一点现场信息" })
    .fill("入口右侧休息区");
  await page.getByRole("button", { name: "把信息补充给景区" }).click();
  await admin.getByRole("button", { name: "刷新", exact: true }).click();
  await admin.locator(".workbench-list>button").first().click();
  await admin.getByLabel("责任人").fill("共护巡查组");
  await admin.getByRole("button", { name: "审核通过并派单" }).click();
  await admin.getByLabel("处理说明").fill("已完成清理，上传现场照片");
  await admin
    .getByLabel("处理后照片")
    .setInputFiles(join(root, "frontend/public/assets/taibai.png"));
  await admin.getByRole("button", { name: "提交整改与照片" }).click();
  await admin.getByRole("button", { name: "AI 对比前后照片" }).click();
  await admin
    .getByRole("button", { name: "人工验收并结案" })
    .waitFor({ state: "visible" });
  await admin.getByLabel("处理说明").fill("人工验收通过，感谢参与共护");
  await Promise.all([
    admin.waitForResponse(
      (r) =>
        r.url().endsWith("/actions") &&
        r.request().postDataJSON()?.action === "close" &&
        r.status() === 200,
    ),
    admin.getByRole("button", { name: "人工验收并结案" }).click(),
  ]);
  await admin.locator(".record").getByText("已结案", { exact: true }).waitFor();
  await page.goto(careURL);
  await page
    .locator(".care-timeline h2")
    .filter({ hasText: "已结案" })
    .waitFor();
  assert.equal(await page.locator(".resolution-photo").count(), 1);
  await page.screenshot({
    path: join(evidence, "06-care-closed.png"),
    fullPage: true,
  });
  saved = await json(
    await fetch(`${origin}/api/events/${receipt.id}`, {
      headers: { "X-Visitor-Token": receipt.token },
    }),
  );
  assert.equal(saved.status, "closed");
  assert.equal(saved.ai_status.resolution, "failed");
  await admin.screenshot({
    path: join(evidence, "07-workbench.png"),
    fullPage: true,
  });
  const fresh = await browser.newContext();
  const recovered = await fresh.newPage();
  await recovered.goto(`${origin}/#/care/recover`);
  await recovered.getByLabel("完整记录编号").fill(receipt.id);
  await recovered.getByLabel("私密访问凭证").fill(receipt.token);
  await recovered.getByRole("button", { name: "翻开这一页" }).click();
  await recovered
    .locator(".care-timeline h2")
    .filter({ hasText: "已结案" })
    .waitFor();
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(origin, { waitUntil: "networkidle" });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile atlas overflow",
  );
  await mobile.screenshot({
    path: join(evidence, "08-mobile.png"),
    fullPage: true,
  });
  await mobile.getByRole("link", { name: "进入太白山" }).click();
  await mobile.getByRole("button", { name: "一起照看这里" }).click();
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile notebook overflow",
  );
  await mobile.screenshot({
    path: join(evidence, "09-mobile-notebook.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 10-city atlas, scene routes, keyboard notebook, private memory, separate care records, real AI failure persistence, supplement, assign, resolution, manual close, receipt recovery, desktop/mobile layouts, no page errors.",
  );
  console.log(`Evidence: ${evidence}`);
  console.log(
    "AI success is covered separately by provider-contract unit tests; this browser run deliberately has no API key.",
  );
} finally {
  await browser?.close();
  server.kill();
}
