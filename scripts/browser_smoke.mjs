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
  assert.equal(await page.getByText("SHAANXI, AT YOUR OWN PACE").count(), 0);
  assert.equal(await page.getByText("一幅山河，许多种相遇。").count(), 0);
  await page.getByRole("heading", { name: "从一处风景开始" }).waitFor();
  const mapWidth = await page
    .locator(".city-boundaries")
    .evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(mapWidth > 1440 * 0.6, "The map must occupy the main visual field");
  await page.getByRole("button", { name: "寻找一处风景" }).click();
  await page.getByRole("searchbox", { name: "景区名称" }).fill("太白山");
  assert.equal(
    await page
      .getByRole("region", { name: "寻找风景" })
      .getByRole("link")
      .count(),
    1,
  );
  await page.keyboard.press("Escape");
  const hotspot = page.getByRole("link", { name: "进入兵马俑" });
  await hotspot.hover();
  assert.ok(
    await page.locator('.landmark[data-city="西安"] img').evaluate((img) => {
      const box = img.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height * 0.2,
      );
      return hit?.closest("a")?.getAttribute("aria-label") === "进入兵马俑";
    }),
    "The warrior head must be visible and clickable, without another city label covering it",
  );
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
  const auth = page.locator(".passport-auth");
  await auth.getByLabel("用户名", {exact:true}).fill("browser_visitor");
  await auth.getByLabel("昵称", {exact:true}).fill("浏览器山河测试");
  await auth.getByLabel("密码", {exact:true}).fill(password);
  await auth.getByLabel("确认密码", {exact:true}).fill(password);
  await auth.getByRole("button", {name:"注册并继续这一程"}).click();
  await page.getByRole("heading", {name:"留住这一刻",exact:true}).waitFor();
  /** Read private server records with this browser's real visitor session. */
  async function ownedEvent(id) {
    const response=await context.request.get(`${origin}/api/events/${id}`);
    assert.equal(response.status(),200);return response.json();
  }
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
  assert.equal(await page.evaluate(()=>localStorage.getItem("gonghu.journey.receipts.v1")),null);
  const receipt = {id:new URL(careURL).hash.split("/").at(-1)};
  let saved=await ownedEvent(receipt.id);
  assert.equal(saved.ai_status.report, "failed");
  assert.equal(saved.analyses.length, 1);
  await page.reload();
  await page.locator(".care-timeline").waitFor();
  await pause(300);
  saved=await ownedEvent(receipt.id);
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
    .setInputFiles(join(root, "frontend/public/assets/terracotta.png"));
  await admin.getByRole("button", { name: "提交整改与照片" }).click();
  await admin.getByRole("button", { name: "发起 AI 核验" }).click();
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
  await page.reload();
  await page
    .locator(".care-timeline h2")
    .filter({ hasText: "已结案" })
    .waitFor();
  assert.equal(await page.locator(".resolution-photo").count(), 1);
  await page.screenshot({
    path: join(evidence, "06-care-closed.png"),
    fullPage: true,
  });
  saved=await ownedEvent(receipt.id);
  assert.equal(saved.status, "closed");
  assert.equal(saved.ai_status.resolution, "failed");
  await admin.screenshot({
    path: join(evidence, "07-workbench.png"),
    fullPage: true,
  });
  const fresh = await browser.newContext();
  const recovered = await fresh.newPage();
  const sameAccount = await fresh.request.post(`${origin}/api/visitor/login`,{data:{username:"browser_visitor",password}});
  assert.equal(sameAccount.status(),200);
  await recovered.goto(careURL);
  await recovered.locator(".care-timeline h2").filter({hasText:"已结案"}).waitFor();
  const chapters = [
    {
      slug: "terracotta",
      name: "兵马俑",
      id: "terracotta-demo",
      point: "terracotta-rest",
      image: "terracotta.png",
    },
    {
      slug: "taibai",
      name: "太白山",
      id: "qinling-demo",
      point: "rest-area",
      image: "taibai.png",
    },
    {
      slug: "huashan",
      name: "华山",
      id: "huashan-demo",
      point: "huashan-rest",
      image: "huashan-v1.png",
    },
    {
      slug: "baotashan",
      name: "宝塔山",
      id: "baotashan-demo",
      point: "baotashan-rest",
      image: "baotashan-v1.png",
    },
    {
      slug: "hanzhong",
      name: "汉中油菜花海",
      id: "hanzhong-demo",
      point: "hanzhong-rest",
      image: "hanzhong-v1.png",
    },
    {
      slug: "zhenbeitai",
      name: "镇北台",
      id: "zhenbeitai-demo",
      point: "zhenbeitai-rest",
      image: "zhenbeitai-v1.png",
    },
  ];
  for (const chapter of chapters) {
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "寻找一处风景" }).click();
    await page.getByRole("searchbox").fill(chapter.name);
    const searchResult = page.locator(".destination-search>a");
    assert.equal(await searchResult.count(), 1);
    await searchResult.click();
    await page.waitForURL(`**/#/scenic/${chapter.slug}`);
    await page
      .locator(".scene-location")
      .filter({ hasText: chapter.name })
      .waitFor();
    const activeNav = page.locator(".journey-header nav a.active");
    assert.equal(
      await activeNav.textContent(),
      chapter.slug === "taibai" ? "秦岭专栏" : "陕西漫游",
    );
    await page.getByRole("link", { name: "回到山河地图" }).click();
    const landmark = page.getByRole("link", {
      name: `进入${chapter.name}`,
      exact: true,
    });
    await landmark.locator(".landmark-name").hover();
    await page
      .getByRole("complementary", {
        name: `${chapter.name}目的地`,
        exact: true,
      })
      .waitFor();
    await page.mouse.move(25, 200);
    await page
      .getByRole("complementary", { name: "兵马俑目的地", exact: true })
      .waitFor();
    await landmark.locator(".landmark-name").click();
    await page.waitForURL(`**/#/scenic/${chapter.slug}`);
    await page.getByRole("button",{name:"领取印记"}).click();
    await page.getByRole("button",{name:"已探索"}).waitFor();
    // Exercise both real upload/save flows for every scenic chapter.
    await page.getByRole("button", { name: "留住这一刻" }).click();
    await page
      .locator("#journal-photo")
      .setInputFiles(join(root, "frontend/public/assets", chapter.image));
    await page
      .getByRole("textbox", { name: "写一句旅途心情" })
      .fill(`六景区验收：${chapter.name}`);
    const previousCount = (await json(await fetch(`${origin}/api/overview`)))
      .total;
    await page.getByRole("button", { name: "收好这一刻" }).click();
    await page.waitForURL("**/#/memory/*");
    await page.reload();
    await page.locator(".memory-postcard").waitFor();
    assert.equal(
      (await json(await fetch(`${origin}/api/overview`))).total,
      previousCount,
    );
    await page.goto(`${origin}/#/scenic/${chapter.slug}`);
    await page.getByRole("button", { name: "一起照看这里" }).click();
    const select = page.locator("select");
    await select.locator("option").nth(1).waitFor({ state: "attached" });
    assert.equal(await select.locator("option").count(), 2);
    await select.selectOption(chapter.point);
    await page
      .locator("#journal-photo")
      .setInputFiles(join(root, "frontend/public/assets", chapter.image));
    await page
      .getByRole("textbox", { name: "说说你看见了什么" })
      .fill(`六景区共护验收：${chapter.name}`);
    await page.getByRole("button", { name: "让这份善意有回音" }).click();
    await page.waitForURL("**/#/care/*");
    await page.getByRole("button", { name: "重新分析" }).waitFor();
    const current = {id:new URL(page.url()).hash.split("/").at(-1)};
    const persisted=await ownedEvent(current.id);
    assert.equal(persisted.scenic_id, chapter.id);
    assert.equal(persisted.point_id, chapter.point);
    assert.equal(persisted.ai_status.report, "failed");
    await page.reload();
    await page.locator(".care-timeline").waitFor();
    await admin.getByRole("button", { name: "刷新", exact: true }).click();
    await admin
      .locator(".workbench-list>button")
      .filter({ hasText: `六景区共护验收：${chapter.name}` })
      .click();
    const configuredPoint = (await json(await fetch(`${origin}/api/overview`)))
      .points.find(p => p.id === chapter.point);
    assert.ok(configuredPoint, "Chapter point must exist in the shared configuration");
    await admin.locator(".record").getByText(configuredPoint.name, { exact: true }).waitFor();
    await recovered.goto(`${origin}/#/care/${current.id}`);
    await recovered.locator(".care-timeline").waitFor();
    const synchronized=await fresh.request.get(`${origin}/api/events/${current.id}`);
    assert.equal((await synchronized.json()).scenic_id,chapter.id);
  }
  await page.goto(`${origin}/#/footprints`,{waitUntil:"networkidle"});
  await page.locator(".passport-cover").waitFor();
  await page.getByRole("button",{name:"勋章册",exact:true}).click();
  assert.equal(await page.locator(".passport-badge.earned").count(),6);
  const passport=await (await context.request.get(`${origin}/api/visitor/me/passport`)).json();
  assert.equal(passport.summary.explored_count,6);
  assert.equal(passport.summary.guardian_value,110);
  await page.screenshot({path:join(evidence,"10-passport-badges.png"),fullPage:true});
  const layouts = await context.newPage();
  layouts.on("pageerror", (e) => errors.push(e.message));
  for (const width of [2048, 1440, 768, 390, 320]) {
    await layouts.setViewportSize({
      width,
      height: width >= 1440 ? 1064 : 900,
    });
    let baseline;
    for (const slug of [null, ...chapters.map((c) => c.slug)]) {
      await layouts.goto(slug ? `${origin}/#/scenic/${slug}` : origin, {
        waitUntil: "networkidle",
      });
      await layouts.evaluate(() => document.fonts.ready);
      const geometry = await layouts.evaluate(() => {
        const header = document.querySelector(".journey-header");
        const brand = document.querySelector(".journey-brand");
        const heading = document.querySelector("h1");
        return {
          height: header.getBoundingClientRect().height,
          brandSize: getComputedStyle(brand).fontSize,
          navSize: getComputedStyle(
            document.querySelector(".journey-header nav"),
          ).fontSize,
          headingSize: getComputedStyle(heading).fontSize,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(geometry.overflow, false, `${width} ${slug} overflow`);
      baseline ||= geometry;
      assert.deepEqual(
        geometry,
        baseline,
        `${width} ${slug} inconsistent header/title scale`,
      );
      if (slug) {
        assert.equal(
          await layouts.locator(".scene-eyebrow,.scene-coordinates").count(),
          0,
        );
        assert.ok(
          (await layouts.locator(".scene-location").textContent()).includes(
            chapters.find((c) => c.slug === slug).name,
          ),
        );
      } else {
        await layouts.getByRole("button", { name: "寻找一处风景" }).click();
        assert.equal(await layouts.locator(".destination-search>a").count(), 6);
        await layouts.keyboard.press("Escape");
        // Sample each visible artwork and label to catch transparent hotspot overlap.
        const hits = await layouts.locator(".landmark a").evaluateAll((links) =>
          links.map((a) => {
            const label = a
              .querySelector(".landmark-name")
              .getBoundingClientRect();
            const image = a.querySelector("img").getBoundingClientRect();
            return {
              name: a.getAttribute("aria-label"),
              label: document
                .elementFromPoint(
                  label.x + label.width / 2,
                  label.y + label.height / 2,
                )
                ?.closest("a")
                ?.getAttribute("aria-label"),
              art: document
                .elementFromPoint(
                  image.x + image.width / 2,
                  image.y + image.height * 0.4,
                )
                ?.closest("a")
                ?.getAttribute("aria-label"),
            };
          }),
        );
        for (const hit of hits) {
          assert.equal(hit.label, hit.name, `${width} label blocked`);
          assert.equal(hit.art, hit.name, `${width} art blocked`);
        }
      }
      await layouts.screenshot({
        path: join(evidence, `layout-${width}-${slug || "atlas"}.png`),
        fullPage: true,
      });
    }
  }
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
    "PASS: 10-city atlas, scene routes, keyboard notebook, private memory, separate care records, real AI failure persistence, supplement, assign, resolution, manual close, visitor registration, account synchronization, desktop/mobile layouts, no page errors.",
  );
  console.log(`Evidence: ${evidence}`);
  console.log(
    "This browser run deliberately has no API key. Real upgrade acceptance runs separately with scripts.live_upgrade_smoke.",
  );
} finally {
  await browser?.close();
  server.kill();
}
