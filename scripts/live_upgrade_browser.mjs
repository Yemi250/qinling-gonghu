/** Actual upgrade UI on a real isolated server; private credentials arrive only on stdin. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { origin, records, adminToken, evidence, afterFixture } = JSON.parse(input);
const [root, duplicate, angle] = records;
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const artifact = { checks: [], widths: [], passed: false };
/** Poll a persisted server predicate; never synthesize an analysis result. */
async function waitEvent(record, predicate, admin = false) {
  for (let i = 0; i < 480; i++) {
    const response = await fetch(`${origin}/api/events/${record.id}`, { headers:
      admin ? { Authorization: `Bearer ${adminToken}` } : { "X-Visitor-Token": record.token } });
    assert.equal(response.status, 200);
    const event = await response.json();
    if (predicate(event)) return event;
    await pause(500);
  }
  throw Error("Persisted event did not reach the required state");
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce" });
  await context.addInitScript(({ records, adminToken }) => {
    localStorage.setItem("gonghu.journey.receipts.v1", JSON.stringify(records));
    sessionStorage.setItem("gonghu.admin", adminToken);
  }, { records, adminToken });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${origin}/#/care/${angle.id}`);
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.screenshot({ path: join(evidence, "01-real-proof-running.png"), fullPage: true });
  let proof = await waitEvent(angle, e => e.proof && e.proof.status !== "running");
  artifact.proofAttempts = [proof.proof];
  for (let attempt = 0; attempt < 2 && proof.proof.status !== "succeeded"; attempt++) {
    console.log(`Real proof ${proof.proof.status}; retrying through the visible recovery action.`);
    await page.getByRole("button", { name: "重新分析", exact: true }).click();
    await waitEvent(angle, e => e.proof.id !== proof.proof.id);
    proof = await waitEvent(angle, e => e.proof && e.proof.status !== "running");
    artifact.proofAttempts.push(proof.proof);
  }
  assert.equal(proof.proof.status, "succeeded", JSON.stringify(proof.proof));
  assert.equal(proof.merged_into, null, "Different photos require manual confirmation");
  await page.locator('.ecoproof:not([aria-busy="true"])').waitFor();
  await page.screenshot({ path: join(evidence, "02-real-proof-finished.png"), fullPage: true });
  artifact.checks.push("Browser starts and polls real persisted proof; different photo stays unmerged");
  console.log("PASS: real content and scene comparison finished; no automatic different-photo merge.");

  await page.goto(`${origin}/#/workbench`);
  await page.locator(".workbench-list>button").filter({ hasText: angle.title }).click();
  const choice = page.locator(`input[type=radio][value="${root.id}"]`);
  await choice.waitFor();
  await choice.check();
  await page.getByRole("button", { name: "确认归并", exact: true }).click();
  await waitEvent(angle, e => e.merged_into === root.id);
  await page.getByRole("button", { name: "撤销这次归并" }).waitFor();
  await page.screenshot({ path: join(evidence, "03-manual-merge.png"), fullPage: true });
  await page.getByRole("button", { name: "前往主事件接力处理" }).click();
  await page.getByLabel("责任人", { exact: true }).fill("模拟演示保洁组");
  await page.getByLabel("处理说明", { exact: true }).fill("模拟场景：复核照片后安排照看。与真实景区业务无关。");
  await page.getByRole("button", { name: "审核通过并派单" }).click();
  await page.getByLabel("处理后照片", { exact: true }).setInputFiles(afterFixture);
  await page.getByLabel("处理说明", { exact: true }).fill("模拟场景：提交同机位清理后的测试照片。");
  await page.getByRole("button", { name: "提交整改与照片" }).click();
  await page.getByRole("button", { name: "发起 AI 核验", exact: true }).click();
  const reviewed = await waitEvent(root, e => e.analyses.some(a =>
    a.kind === "resolution" && a.status !== "running"), true);
  const review = reviewed.analyses.filter(a => a.kind === "resolution").at(-1);
  assert.equal(review.status, "succeeded", JSON.stringify(review));
  assert.equal(review.result.same_image, false);
  assert.equal(reviewed.status, "pending_acceptance", "AI must not automatically close a case");
  await page.getByRole("heading", { name: "AI 整改核验" }).waitFor();
  await page.screenshot({ path: join(evidence, "04-real-resolution-review.png"), fullPage: true });
  assert.equal(await page.getByRole("button", { name: "人工验收并结案" }).isEnabled(), false);
  await page.getByLabel("处理说明（结案与退回都需要填写）").fill(
    "模拟演示验收：核对整改前后测试照片，可见散落垃圾已清理；人工确认结案。此记录不代表真实现场整改。");
  await page.getByRole("button", { name: "人工验收并结案" }).click();
  await waitEvent(root, e => e.status === "closed", true);
  artifact.checks.push("Administrator explicitly merges, assigns, submits new photo, runs real VLM review, and closes with a note");
  console.log(`PASS: real rectification suggestion ${review.result.suggestion}; human closure recorded.`);

  for (const record of [root, duplicate, angle]) {
    await page.goto(`${origin}/#/care/${record.id}`);
    await page.locator(".ecoproof-share").waitFor();
    const shared = await page.locator(".ecoproof-share").textContent();
    assert.ok(shared.includes("3") && shared.includes("2") && shared.includes("1"));
    await page.reload();
    await page.locator(".ecoproof-share").waitFor();
    const saved = await waitEvent(record, e => e.governance?.status === "closed");
    assert.equal(saved.governance.case_id, root.id);
  }
  artifact.checks.push("All three original private receipts survive merge and receive shared closure after reload");
  for (const width of [320, 390, 768, 1440, 2048]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const route of [`care/${angle.id}`, "workbench"]) {
      await page.goto(`${origin}/#/${route}`);
      if (route === "workbench") {
        await page.locator(".workbench-list>button").filter({ hasText: root.title }).click();
        await page.getByRole("heading", { name: "AI 整改核验" }).waitFor();
      } else await page.locator(".ecoproof-share").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const size = await page.evaluate(() => ({ viewport: innerWidth,
        body: document.documentElement.scrollWidth }));
      assert.ok(size.body <= size.viewport + 1, `${route} at ${width}: ${JSON.stringify(size)}`);
      artifact.widths.push({ route, ...size });
      if ([390, 1440].includes(width)) await page.screenshot({
        path: join(evidence, `05-${route.split("/")[0]}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  artifact.passed = true;
  console.log("PASS: shared feedback, private receipts and 10 responsive page checks; no browser exceptions.");
} finally {
  await writeFile(join(evidence, "browser-upgrade.json"), JSON.stringify(artifact, null, 2));
  await browser.close();
}
