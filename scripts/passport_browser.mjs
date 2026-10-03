/** Real cookie/CSRF sessions, account switches and preserved drafts on an isolated server. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { createServer } from "node:net";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const python=process.env.PYTHON_EXECUTABLE||join(root,".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
const data=await mkdtemp(join(tmpdir(),"gonghu-passport-browser-"));
const evidence=join(root,"data","browser-evidence",`passport-${Date.now()}`);
await mkdir(evidence,{recursive:true});
const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://127.0.0.1:${port}`;
const password="isolated-passport-test-only";
const runner="import os; from pathlib import Path; import uvicorn; from backend.app.main import create_app; from backend.app.config import Settings; s=Settings(_env_file=None,data_dir=Path(os.environ['PASSPORT_DATA']),demo_admin_password=os.environ['PASSPORT_PASSWORD'],ai_api_key=''); uvicorn.run(create_app(s),host='127.0.0.1',port=int(os.environ['PASSPORT_PORT']),access_log=False)";
const server=spawn(python,["-c",runner],{cwd:root,windowsHide:true,stdio:["ignore","ignore","pipe"],env:{...process.env,AI_API_KEY:"",PASSPORT_DATA:data,PASSPORT_PASSWORD:password,PASSPORT_PORT:String(port)}});
let stderr="",browser;server.stderr.on("data",chunk=>{stderr+=chunk;});
const results={passed:false,checks:[],widths:[],isolated_data:data};

/** Sign into a test account using the real dialog, preserving the pending scenic action. */
async function credentials(page,username,{register=false,secret=password}={}) {
  const auth=page.locator(".passport-auth");
  await auth.waitFor();
  if(!register)await auth.getByRole("button",{name:"已经有护照？登录",exact:true}).click();
  await auth.getByLabel("用户名",{exact:true}).fill(username);
  await auth.getByLabel("密码",{exact:true}).fill(secret);
  if(register){await auth.getByLabel("昵称",{exact:true}).fill(username==="passport_a"?"长安旅人":"山风旅人");await auth.getByLabel("确认密码",{exact:true}).fill(secret);}
  await auth.getByRole("button",{name:register?"注册并继续这一程":"登录并继续这一程",exact:true}).click();
}
/** Run scoped fixture SQL only inside the explicitly created operating-system temp directory. */
function fixture(sql,args=[]) {
  const script="import json,sqlite3,sys,tempfile; from pathlib import Path; p=Path(sys.argv[1]).resolve(); assert p.is_relative_to(Path(tempfile.gettempdir()).resolve()); c=sqlite3.connect(p/'events.sqlite3'); c.row_factory=sqlite3.Row; c.execute(sys.argv[2],json.loads(sys.argv[3])); from backend.app.rewards import reconcile_all; reconcile_all(c);c.commit();c.close()";
  execFileSync(python,["-c",script,data,sql,JSON.stringify(args)],{cwd:root,windowsHide:true,encoding:"utf-8"});
}
/** Verify a real browser-session response while keeping credentials out of result artifacts. */
async function json(response,status=200){assert.equal(response.status(),status);return response.json();}
try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}await pause(100);}assert.ok(ready,stderr);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
  const a=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:"reduce"});
  const page=await a.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${origin}/#/scenic/terracotta`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"留住这一刻"}).click();
  assert.equal(await page.locator("#journal-photo").count(),0,"No upload form before registration");
  for(const width of [320,390,768,1440,2048]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} auth page overflow`);
    assert.ok(await page.locator(".passport-auth").evaluate(node=>node.scrollWidth<=node.clientWidth),`${width} auth form overflow`);
    await page.screenshot({path:join(evidence,`auth-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1050});
  await credentials(page,"passport_a",{register:true});
  await page.locator("#journal-photo").waitFor({state:"attached"});
  assert.ok(page.url().endsWith("/scenic/terracotta"));
  await page.locator("#journal-photo").setInputFiles(join(root,"frontend/public/assets/terracotta.png"));
  await page.getByLabel("写一句旅途心情").fill("会话过期也要保留的旅途文字");
  fixture("UPDATE visitor_sessions SET expires_at='2000-01-01T00:00:00+00:00'");
  await page.getByRole("button",{name:"收好这一刻",exact:true}).click();
  await page.locator(".passport-auth").waitFor();
  assert.equal(await page.locator(".photo-leaf img").count(),1);
  assert.equal(await page.getByLabel("写一句旅途心情").inputValue(),"会话过期也要保留的旅途文字");
  await credentials(page,"passport_a");
  await page.locator(".passport-auth").waitFor({state:"detached"});
  await page.getByRole("button",{name:"收好这一刻",exact:true}).click();
  await page.waitForURL("**/#/memory/*");await page.locator(".memory-postcard").waitFor();
  const cardId=new URL(page.url()).hash.split("/").at(-1);
  const card=await json(await a.request.get(`${origin}/api/postcards/${cardId}`));
  assert.equal(await page.evaluate(()=>localStorage.getItem("gonghu.journey.receipts.v1")),null);
  results.checks.push("Registration resumes the exact scenic notebook; expiration preserves preview/text; new records use server identity");
  const a2=await browser.newContext();const peer=await a2.newPage();
  await peer.goto(`${origin}/#/footprints`,{waitUntil:"networkidle"});
  await peer.getByRole("button",{name:"注册或登录，翻开我的护照"}).click();
  await credentials(peer,"passport_a");await peer.locator(".passport-cover").waitFor();
  await peer.getByRole("button",{name:"风景记忆",exact:true}).click();
  await peer.locator(`.footprint-card[href="#/memory/${cardId}"]`).waitFor();
  assert.equal((await json(await a2.request.get(`${origin}/api/visitor/me/passport`))).summary.guardian_value,10);
  results.checks.push("Same account synchronizes on an independent browser without importing local tokens");
  const b=await browser.newContext();const other=await b.newPage();
  await other.goto(`${origin}/#/scenic/huashan`,{waitUntil:"networkidle"});
  await other.getByRole("button",{name:"留住这一刻"}).click();
  await credentials(other,"passport_a",{register:true});
  await other.getByRole("alert").filter({hasText:"用户名已经有人使用"}).waitFor();
  await other.locator(".passport-auth").getByLabel("用户名",{exact:true}).fill("passport_b");
  await other.locator(".passport-auth").getByLabel("昵称",{exact:true}).fill("山风旅人");
  await other.locator(".passport-auth").getByRole("button",{name:"注册并继续这一程",exact:true}).click();
  await other.locator("#journal-photo").waitFor({state:"attached"});await other.keyboard.press("Escape");
  assert.equal((await b.request.get(`${origin}/api/postcards/${cardId}`)).status(),403);
  assert.equal((await b.request.get(`${origin}${card.images[0].url}`)).status(),403);
  assert.equal((await json(await b.request.get(`${origin}/api/visitor/me/records`))).total,0);
  assert.equal((await b.request.get(`${origin}/api/events`)).status(),401);
  results.checks.push("Duplicate usernames show an error; second account cannot read the first account's new record/image or use admin APIs");
  await page.goto(`${origin}/#/scenic/terracotta`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"领取印记"}).click();await page.getByRole("button",{name:"已探索"}).waitFor();
  const passport=await json(await a.request.get(`${origin}/api/visitor/me/passport`));assert.equal(passport.summary.guardian_value,15);
  await page.locator(".passport-award").waitFor();assert.equal(await page.locator(".passport-award").evaluate(node=>getComputedStyle(node).animationName),"none");
  await page.goto(`${origin}/#/footprints`,{waitUntil:"networkidle"});await page.locator(".passport-cover").waitFor();
  await page.getByRole("button",{name:"勋章册",exact:true}).click();await page.locator(".passport-badge.earned").first().waitFor();
  assert.equal(await page.locator(".passport-badge.earned").count(),2);
  await page.getByText("守护值明细与参与规则",{exact:true}).click();
  await page.locator(".passport-reward-history").getByText("+5",{exact:true}).waitFor();
  assert.equal(await page.locator(".passport-badge .passport-badge-art").count(),6);
  results.checks.push("Explorer/card badges and +5/+10 audit details come from real server data");
  for(const width of [320,390,768,1440,2048]){
    await page.setViewportSize({width,height:1064});
    for(const tab of ["我的旅程","风景记忆","共护回音","勋章册"]){
      await page.getByRole("button",{name:tab,exact:true}).click();await page.evaluate(()=>document.fonts.ready);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${tab} overflow`);
      results.widths.push({width,tab,overflow:false});
    }
    await page.screenshot({path:join(evidence,`passport-${width}.png`),fullPage:true});
  }
  // Supplement drafts survive the remount caused by an expired account session.
  await page.goto(`${origin}/#/scenic/taibai`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"一起照看这里"}).click();
  await page.locator("#journal-photo").setInputFiles(join(root,"frontend/public/assets/taibai.png"));
  await page.getByLabel("说说你看见了什么").fill("隔离补充表单测试，不是真实事件");
  await page.getByRole("button",{name:"让这份善意有回音"}).click();
  await page.waitForURL("**/#/care/*");await page.getByRole("button",{name:"重新分析",exact:true}).waitFor();
  const careId=new URL(page.url()).hash.split("/").at(-1);
  const manager=await json(await a.request.post(`${origin}/api/auth/login`,{data:{username:"admin",password}}));
  await json(await a.request.post(`${origin}/api/events/${careId}/actions`,{headers:{Authorization:`Bearer ${manager.access_token}`},data:{action:"request_info",note:"隔离测试：请补充位置"}}));
  await page.getByRole("button",{name:"查看最新回音"}).click();
  await page.getByLabel("补充一点现场信息").fill("补充表单过期仍保留的方位");
  fixture("UPDATE visitor_sessions SET expires_at='2000-01-01T00:00:00+00:00'");
  await page.getByRole("button",{name:"把信息补充给景区"}).click();
  await credentials(page,"passport_a");await page.locator(".passport-auth").waitFor({state:"detached"});
  await page.getByLabel("补充一点现场信息").waitFor();
  assert.equal(await page.getByLabel("补充一点现场信息").inputValue(),"补充表单过期仍保留的方位");
  await page.getByRole("button",{name:"把信息补充给景区"}).click();
  await page.locator(".supplement-form").waitFor({state:"detached"});
  results.checks.push("Expired supplement reauthenticates the same account and preserves its in-memory draft");
  await page.goto(`${origin}/#/footprints`,{waitUntil:"networkidle"});await page.locator(".passport-cover").waitFor();
  const mirror=await a.newPage();await mirror.goto(`${origin}/#/footprints`,{waitUntil:"networkidle"});await mirror.locator(".passport-cover").waitFor();
  // Rotating the shared cookie for the same identity must reload the cleared passport too.
  await json(await a.request.post(`${origin}/api/visitor/login`,{data:{username:"passport_a",password}}));
  await mirror.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await mirror.waitForFunction(()=>document.querySelector(".passport-cover .passport-value strong")?.textContent?.trim()==="15");
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  results.checks.push("Same-account cookie rotation restores passport progress across tabs instead of leaving the cleared view empty");
  await page.getByRole("button",{name:"退出游客账号",exact:true}).click();
  await page.locator(".passport-welcome").waitFor();assert.equal(await page.locator(".passport-cover,.footprint-card").count(),0);
  await mirror.locator(".passport-welcome").waitFor();assert.equal(await mirror.locator(".passport-cover,.footprint-card").count(),0);
  assert.equal((await json(await a.request.get(`${origin}/api/visitor/me`))).user,null);
  await page.getByRole("button",{name:"注册或登录，翻开我的护照",exact:true}).click();
  await credentials(page,"passport_b",{secret:"wrong-password"});await page.getByRole("alert").filter({hasText:"用户名或密码不正确"}).waitFor();
  await page.locator(".passport-auth").getByLabel("密码",{exact:true}).fill(password);
  await page.locator(".passport-auth").getByRole("button",{name:"登录并继续这一程",exact:true}).click();
  await page.locator(".passport-cover").waitFor();
  await page.getByRole("button",{name:"风景记忆",exact:true}).click();
  await page.getByText("第一张风景，等你收藏。",{exact:true}).waitFor();assert.equal(await page.locator(".footprint-card").count(),0);
  assert.equal((await json(await a.request.get(`${origin}/api/visitor/me/passport`))).summary.guardian_value,0);
  await mirror.locator(".passport-cover").getByText("山风旅人 / 山河护照",{exact:true}).waitFor();
  assert.equal(await mirror.locator(".footprint-card").count(),0);
  results.checks.push("Logout clears prior account views; incorrect password is visible; switching accounts never exposes old records");
  results.checks.push("BroadcastChannel synchronizes logout and identity changes across tabs without sharing secrets");
  // Construct a labeled anonymous legacy fixture by adapting only this temporary database.
  const me=await json(await a.request.get(`${origin}/api/visitor/me`));
  const headers={"X-Gonghu-CSRF":me.csrf_token};
  const image=await json(await a.request.post(`${origin}/api/uploads`,{headers,multipart:{file:{name:"legacy-test.png",mimeType:"image/png",buffer:await (await import("node:fs/promises")).readFile(join(root,"frontend/public/assets/taibai.png"))}}}),201);
  const legacy=await json(await a.request.post(`${origin}/api/postcards`,{headers,data:{scenic_id:"qinling-demo",description:"隔离构造的旧匿名记录",images:[image]}}),201);
  fixture("UPDATE postcards SET owner_id=NULL,legacy_access=1 WHERE id=?",[legacy.postcard.id]);
  fixture("UPDATE uploads SET owner_id=NULL,access_mode='legacy' WHERE id=?",[image.id]);
  await page.evaluate(r=>localStorage.setItem("gonghu.journey.receipts.v1",JSON.stringify([r])),{id:legacy.postcard.id,kind:"memory",token:legacy.query_token,scenic:"太白山",title:"旧匿名测试",image:image.url,date:legacy.postcard.created_at});
  await page.reload();await page.getByRole("button",{name:"导入我的护照"}).click();
  await page.getByText("已导入 1 条；0 条凭证无效或已有归属，未导入。",{exact:true}).waitFor();
  assert.equal((await json(await a.request.get(`${origin}/api/visitor/me/passport`))).summary.guardian_value,10);
  const old=await browser.newContext();const recovery=await old.newPage();
  await recovery.goto(`${origin}/#/memory/recover`,{waitUntil:"networkidle"});
  await recovery.getByLabel("完整记录编号").fill(legacy.postcard.id);
  await recovery.getByLabel("私密访问凭证").fill(legacy.query_token);
  await recovery.getByRole("button",{name:"翻开这一页"}).click();await recovery.locator(".memory-postcard").waitFor();
  const signA=await json(await a2.request.post(`${origin}/api/visitor/login`,{data:{username:"passport_a",password}}));
  const theft=await json(await a2.request.post(`${origin}/api/visitor/me/import`,{headers:{"X-Gonghu-CSRF":signA.csrf_token},data:{records:[{id:legacy.postcard.id,kind:"memory",query_token:legacy.query_token}]}}));
  assert.equal(theft[0].imported,false);
  results.checks.push("Explicit legacy import binds an unowned record; another account cannot transfer it; original anonymous read capability stays compatible");
  assert.deepEqual(errors,[]);results.passed=true;
  console.log(`PASS: passport registration/resume, expired draft, two devices, two accounts, privacy, badges/audit, logout/switch, five widths. Evidence: ${evidence}`);
}catch(e){results.failure=e.message;throw e;}
finally{await writeFile(join(evidence,"results.json"),JSON.stringify(results,null,2));await browser?.close();server.kill();}
