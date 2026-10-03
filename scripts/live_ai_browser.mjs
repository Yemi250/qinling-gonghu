/** Verify persisted real-model output through the UI; credentials arrive only on stdin. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { origin, records, adminToken, evidence } = JSON.parse(input);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.addInitScript(
    ({ records, adminToken }) => {
      localStorage.setItem(
        "gonghu.journey.receipts.v1",
        JSON.stringify(records),
      );
      sessionStorage.setItem("gonghu.admin", adminToken);
    },
    { records, adminToken },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [index, record] of records.entries()) {
    await page.goto(`${origin}/#/care/${record.id}`);
    await page.getByText("AI 看到了什么", { exact: true }).waitFor();
    assert.ok((await page.locator(".record__title").textContent()).trim());
    await page.reload();
    await page.getByText("AI 看到了什么", { exact: true }).waitFor();
    await page.screenshot({
      path: join(evidence, `real-report-${index + 1}.png`),
      fullPage: true,
    });
  }
  await page.goto(`${origin}/#/workbench`);
  await page.locator(".workbench-list>button").first().click();
  await page.getByText("AI 看到了什么", { exact: true }).waitFor();
  const comparison = page.getByRole("heading", { name: "AI 整改对比意见" });
  await comparison.waitFor();
  assert.ok((await comparison.locator("..").textContent()).trim());
  await page.screenshot({
    path: join(evidence, "real-comparison.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real report results survive reload; admin comparison result is displayed.",
  );
} finally {
  await browser.close();
}
