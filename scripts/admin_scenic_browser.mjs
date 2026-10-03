/** Real HTTP/browser checks for destination queues; isolated database and no model calls. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { createServer } from "node:net";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const data = await mkdtemp(join(tmpdir(), "gonghu-scenic-browser-"));
const evidence = join(root, "data", "browser-evidence", `scenic-admin-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const listener = createServer();
await new Promise(r => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise(r => listener.close(r));
const origin = `http://127.0.0.1:${port}`;
const password = "isolated-scenic-test-only";
const runner = "import os; from pathlib import Path; import uvicorn; from backend.app.main import create_app; from backend.app.config import Settings; s=Settings(_env_file=None,data_dir=Path(os.environ['SCENIC_DATA']),demo_admin_password=os.environ['SCENIC_PASSWORD'],ai_api_key=''); uvicorn.run(create_app(s),host='127.0.0.1',port=int(os.environ['SCENIC_PORT']),access_log=False)";
const python = process.env.PYTHON_EXECUTABLE || join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const server = spawn(python, ["-c", runner], {
  cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, AI_API_KEY: "", SCENIC_DATA: data, SCENIC_PASSWORD: password, SCENIC_PORT: String(port) },
});
let stderr = "";
server.stderr.on("data", chunk => { stderr += chunk.toString(); });
let browser;
/** Check HTTP results without logging credentials or submission receipts. */
async function json(path, options = {}, status = 200) {
  const response = await fetch(`${origin}/api/${path}`, options);
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`);
  return response.json();
}
/** Wait for the requested scope's completed response rather than a timed animation. */
async function loaded(page, name, count) {
  await page.getByText(`${name} · 共 ${count} 件治理事件`, { exact: true }).waitFor();
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } }
    catch { /* Independent server startup. */ }
    await pause(250);
  }
  assert.ok(ready, stderr);
  const session = await json("auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }) });
  const adminHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
  const scenes = [
    ["terracotta-demo", "兵马俑", "terracotta-entry", "terracotta-rest"],
    ["qinling-demo", "太白山", "trail-entrance", "rest-area"],
    ["huashan-demo", "华山", "huashan-entry", "huashan-rest"],
    ["baotashan-demo", "宝塔山", "baotashan-entry", "baotashan-rest"],
    ["hanzhong-demo", "汉中油菜花海", "hanzhong-entry", "hanzhong-rest"],
    ["zhenbeitai-demo", "镇北台", "zhenbeitai-entry", "zhenbeitai-rest"],
  ];
  const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const ids = {};
  for (const [id, name, entry, rest] of scenes) {
    ids[id] = [];
    for (let n = 0; n < (id === "terracotta-demo" ? 21 : 2); n++) {
      const form = new FormData();
      form.append("file", new Blob([fixture], { type: "image/png" }), "isolated-test.png");
      const image = await json("uploads", { method: "POST", body: form }, 201);
      const result = await json("events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenic_id: id, point_id: n % 2 ? rest : entry, description: `隔离浏览器测试 · ${name} · ${n + 1}，非真实事件`, original_images: [image], is_demo: true }) }, 201);
      ids[id].push(result.event.id);
    }
  }
  await json(`events/${ids["huashan-demo"][0]}/actions`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ action: "reject", note: "隔离测试：已人工归档" }) });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" });
  await context.addInitScript(token => sessionStorage.setItem("gonghu.admin", token), session.access_token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/#/workbench`, { waitUntil: "networkidle" });
  await loaded(page, "全部景区", 31);
  const nav = page.getByRole("navigation", { name: "按景区查看治理事件" });
  assert.equal(await nav.getByRole("button").count(), 7);
  for (const [id, name] of scenes) {
    await nav.getByRole("button", { name: new RegExp(`^${name}，`) }).click();
    await loaded(page, name, id === "terracotta-demo" ? 21 : 2);
    assert.equal(await page.getByLabel("具体点位").locator("option").count(), 3);
    const titles = await page.locator(".workbench-list > button strong").allTextContents();
    assert.ok(titles.length > 0 && titles.every(title => title.includes(` · ${name} · `)));
  }
  await nav.getByRole("button", { name: /^兵马俑，待处理 21 件$/ }).click();
  await loaded(page, "兵马俑", 21);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".workbench-list > button").length === 1);
  await page.getByLabel("具体点位").selectOption("terracotta-entry");
  await loaded(page, "兵马俑", 11);
  assert.equal(await page.locator(".workbench-list > button").count(), 11);
  assert.ok(await page.getByRole("button", { name: "上一页", exact: true }).isDisabled());
  await page.locator(".workbench-list > button").first().click();
  await page.getByLabel("责任人", { exact: true }).fill("隔离测试保洁组");
  await page.getByRole("button", { name: "审核通过并派单", exact: true }).click();
  await page.getByRole("button", { name: "提交整改与照片", exact: true }).waitFor();
  await page.getByLabel("处理阶段").selectOption("processing");
  await loaded(page, "兵马俑", 1);
  assert.equal(await page.locator(".action-sheet").count(), 0, "Stage switches must clear action drafts");
  await nav.getByRole("button", { name: /^华山，待处理 1 件$/ }).click();
  await loaded(page, "华山", 0);
  assert.equal(await page.getByLabel("具体点位").inputValue(), "");
  await page.getByLabel("处理阶段").selectOption("");
  await loaded(page, "华山", 2);
  await page.locator(".workbench-list > button").filter({ hasText: " · 2，" }).click();
  await page.getByLabel("处理说明", { exact: true }).fill("隔离测试：人工核对后归档");
  await page.getByRole("button", { name: "说明后归档", exact: true }).click();
  await nav.getByRole("button", { name: /^华山，待处理 0 件$/ }).waitFor();
  await nav.getByRole("button", { name: /^太白山，/ }).click();
  await loaded(page, "太白山", 2);
  assert.equal(await page.locator(".action-sheet").count(), 0, "Destination switches must clear prior details");

  // Delay a real old HTTP request to verify its response cannot replace the new scope.
  await page.route("**/api/events?*", async route => {
    if (new URL(route.request().url()).searchParams.get("scenic_id") === "terracotta-demo") await pause(600);
    await route.continue();
  });
  const late = page.waitForResponse(r => r.url().includes("scenic_id=terracotta-demo") && !r.url().includes("/actions"));
  await nav.getByRole("button", { name: /^兵马俑，/ }).click();
  await nav.getByRole("button", { name: /^镇北台，/ }).click();
  await loaded(page, "镇北台", 2);
  await late;
  await pause(150);
  await loaded(page, "镇北台", 2);
  assert.ok((await page.locator(".workbench-list > button strong").allTextContents()).every(title => title.includes("镇北台")));
  await page.unroute("**/api/events?*");

  // A list failure must show an error and remain retryable; it must not look like an empty queue.
  await page.route("**/api/events?*", route => route.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("事件未能读取，请刷新重试。", { exact: true }).waitFor();
  await page.unroute("**/api/events?*");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await loaded(page, "镇北台", 2);
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.route("**/api/overview", route => route.abort());
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("景区待处理统计暂不可用，请刷新重试。", { exact: true }).waitFor();
  assert.equal(await page.locator(".workbench-list > button").count(), 2);
  assert.equal(await nav.getByRole("button", { name: /待处理 暂不可用 件/ }).count(), 7);
  await page.unroute("**/api/overview");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await nav.getByRole("button", { name: /^镇北台，待处理 2 件$/ }).waitFor();

  const layouts = [];
  for (const width of [320, 390, 768, 1440, 2048]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    for (const button of await nav.getByRole("button").all()) assert.ok(await button.isVisible());
    await page.screenshot({ path: join(evidence, `admin-scenic-${width}.png`), fullPage: true });
    layouts.push({ width, overflow: false, navigationButtons: 7 });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, "result.json"), JSON.stringify({ passed: true, destinations: 6, seededSubmissions: 31, tests: ["destination queues", "pagination", "point/stage intersection", "action and counter refresh", "selection clearing", "late response", "list failure and retry", "statistics failure and retry"], layouts, modelCalls: 0, isolatedData: data }, null, 2));
  console.log(`PASS: six destinations, point/stage filters, pagination, counters, scope clearing, stale response protection, failures/retries, five responsive widths. Evidence: ${evidence}`);
} finally {
  await browser?.close();
  server.kill();
}
