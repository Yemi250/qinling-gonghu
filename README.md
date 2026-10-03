# 秦岭共护

**山河有回响，等你来一趟。** 面向景区运营团队与游客的 AI 环境共护原型：从陕西漫游地图出发，游客收藏旅途照片，记录需要照看的地方；AI 整理环境线索，景区工作人员审核、派单、上传处理照片并人工验收。

当前包含陕西十市地图与六个可操作篇章：兵马俑、太白山、华山、宝塔山、汉中油菜花海、镇北台。六景区共用导航、首屏比例和随行手记，各有独立意境与配色；支持私密照片收藏、环境共护记录和景区工作台。照片收藏独立存储，不生成治理工单。全部点位均为示范点位，未正式接入真实景区。

已实现 **EcoProof 证据分析、共同治理事件归并、AI 整改核验**。模型整理照片依据；系统区分重复图片与不同图片；管理员对照候选确认归并、处理与验收。各份游客原凭证仍可查看共同回音，不显示虚构真实性百分比，不把投稿数当作人数。

上一轮真实验收中，本机硅基流动 `Qwen/Qwen3-VL-30B-A3B-Instruct` 已通过真实识图、不同角度关联比对、整改前后对比、保存与浏览器刷新验收。该轮 5 次上游调用成功，另有 2 次网络失败经页面重试恢复；同图整改负例由系统检查拦截，没有调用模型。测试图片明确标注为模拟场景，连接与流程通过不代表实际准确率或真实整改效果。见 [EcoProof升级验收](docs/EcoProof升级验收.md) 与 [升级契约](docs/EcoProof升级契约.md)。此前六景区记录保留于 [六景区体验与模型验收](docs/六景区体验与模型验收.md)。

当前升级为 **山河护照、景区探索印记与共护勋章**：地图与景区介绍可直接浏览，收藏、投稿与个人护照要求游客账号登录。六景区的探索印记、私密明信片、有效共护贡献，均由服务端计算进度；六枚原创 SVG 勋章与守护值按真实记录解锁。重复图片不算独立共护贡献，关联成功也不会自动奖励。见 [游客护照契约与使用说明](docs/游客护照契约与使用说明.md)。

## 体验路线

1. 首页悬停或聚焦六个地标，查看目的地便笺；点击地标或便笺进入对应景区，移开恢复默认兵马俑介绍。搜索可按景区名或城市名查找六个目的地。
2. 在景区随行手记主动领取线上探索印记；翻开“随行手记”时注册或登录游客账号，再继续原操作：**留住这一刻**上传照片并保存私密明信片；**一起照看这里**保存照片、描述与点位，再发起真实 AI 分析。
3. “我的足迹”是四视图山河护照：我的旅程、风景记忆、共护回音、勋章册；同一账号在另一浏览器登录即可同步。旧匿名记录保留编号与原凭证找回入口，在当前浏览器可主动确认“导入我的护照”。退出或换账号立即清空上一账号的界面数据。
4. 页脚进入“景区工作台”，用本地环境配置中的管理账号登录。按六景区导航查看待处理数量，再按具体点位和处理阶段筛选，完成补充信息、派单、整改照片、AI 前后对比及人工验收。切换景区清空原详情与草稿，保留处理阶段；见 [管理端景区分类](docs/管理端景区分类.md)。
5. 游客刷新回音，看到责任人、处理后照片与完整时间线。AI 失败会明确显示，原材料仍可读取，工作人员仍可人工处理。

视觉与实现说明见 [沉浸式漫游交付](docs/沉浸式漫游交付.md)，生成资产与地图来源见 [视觉资产记录](docs/视觉资产记录.md)。首页已按用户提供的参考图重做为水墨山河画卷，实际截图与新资产提示词见 [首页参考图还原](docs/首页参考图还原.md)。

## 本地运行

需要 [uv](https://docs.astral.sh/uv/getting-started/installation/) 和 Node.js 22.12+。Python 3.12 由 uv 自动准备。所有命令在仓库根目录执行。

1. 复制 `.env.example` 为 `.env`，将 `DEMO_ADMIN_PASSWORD` 改成至少 12 位自选密码（以 `replace-` 开头的示例密码会被拒绝）。默认账号为 `admin`。PowerShell 可用 `Copy-Item .env.example .env`，macOS/Linux 用 `cp .env.example .env`。
2. 安装锁定依赖并构建前端：

```text
uv sync --locked
npm --prefix frontend ci
npm --prefix frontend run build
```

3. 启动单后端、单端口：

```text
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

访问 [陕西漫游](http://127.0.0.1:8000)、[景区工作台](http://127.0.0.1:8000/#/workbench)、[交互 API 文档](http://127.0.0.1:8000/docs) 或 [健康检查](http://127.0.0.1:8000/api/health)。后端同时提供 API、图片和前端构建产物，Hash 路由支持刷新与直达。未构建前端时后端 API 也可使用。

前端开发可在另一终端执行 `npm --prefix frontend run dev`，打开 [Vite](http://127.0.0.1:5173)，其 `/api` 代理至 8000。无需开放宽泛 CORS。正常运行仅用一个后端 worker；重启恢复逻辑不支持多个 worker 共享任务。

## 跑通一次闭环

可在 `/docs` 逐个请求，或运行真实 HTTP 验证脚本 `uv run python -m scripts.smoke`（使用临时目录、自行启动并重启后端，不污染演示数据）。该脚本使用人工闭环，AI 缺失如实记录失败。

1. 先 `POST /api/visitor/register`（username/password/confirm_password/nickname）或 `/login`，保留游客会话 Cookie；后续游客写请求带返回的 `X-Gonghu-CSRF`。再 `POST /api/uploads` 上传照片，保存 `id`、`upload_token`。
2. `POST /api/events` 填入 `scenic_id=qinling-demo`、`point_id=trail-entrance`、描述及图片凭证；演示素材带 `is_demo=true`。新记录归属当前账号；兼容返回的 `query_token` 不能绕过账号权限。
3. `POST /api/events/{id}/proof`，携带游客会话 Cookie 与 CSRF，返回 202。随后 GET 读取真实材料检查、内容分析、关联比对、处置建议。未配置或调用失败时保留已完成阶段和材料，可重试或人工处理；既有 `/analysis` 路径保持兼容。
4. `POST /api/auth/login` 登录。后续管理员请求带 `Authorization: Bearer <access_token>`。
5. `/actions` 依次调用 assign（assignee）、submit_resolution（新上传的 resolution_images 和 note）、close（人工验收 note）。必要时 request_info → supplement，或验收 return → 再次整改。
6. 游客用 `GET /api/events/{id}` 和自己的账号会话查看材料、状态、复核说明与时间线。管理员在详情内审核有效贡献，根投稿通过并派单后可记为有效；归并子投稿必须逐份确认。游客不能读取他人新记录、派单或结案。

字段、响应、状态矩阵和错误格式见 [API 清单](docs/API.md)；[OpenAPI 快照](docs/openapi.json) 与前端生成类型一起提交。

## 配置与数据

| 配置 | 含义 |
|---|---|
| DEMO_ADMIN_USERNAME / DEMO_ADMIN_PASSWORD | 管理员演示账号，密码不写入数据库或前端 |
| DEMO_ADMIN_MIN_PASSWORD_LENGTH | 默认最少12位；本机演示可显式调整，最低8位，修改后重启服务 |
| VISITOR_SESSION_HOURS | 游客会话默认168小时；与管理员会话分离 |
| VISITOR_COOKIE_SECURE | HTTPS请求自动设Secure；反向代理部署可显式开启 |
| DATA_DIR | SQLite 和图片目录，默认仓库 data/ |
| AI_BASE_URL / AI_MODEL / AI_API_KEY | 仅服务端使用，默认百炼兼容地址和 qwen3-vl-plus；需配置可用模型凭据 |
| AI_TIMEOUT_SECONDS | 单次分析总超时，默认 60 秒 |
| MAX_UPLOAD_BYTES | 单张上传上限，默认 10 MiB；另限 2000 万像素 |

`data/events.sqlite3` 保存事件、私密明信片、会话哈希、上传绑定、时间线、分析版本及证据任务；`data/images/` 保存去除元信息后的 JPEG。**重启不会清空数据。** 本轮迁移至数据库版本3，现有版本1/2库升级前自动使用 SQLite backup 备份到 `DATA_DIR/backups/before-v3-*.sqlite3`，保留原材料和凭证，并新增游客账户、会话、探索、贡献审核、奖励及调整记录。备份图片仍需停服务并复制完整 DATA_DIR（包括 WAL/SHM 如存在），恢复时使用匹配版本代码。源码升级不能删除此目录。空库不会自动灌入业务记录。

新图片需要所属游客会话或管理员鉴权；整改图片可由该治理事件的参与账号读取，其他游客原图仍相互隔离。历史匿名图片维持既有随机链接兼容方式。新记录按账号访问，原匿名记录仍可用原凭证读取与主动导入；凭证不要放 URL 或日志。游客密码使用随机盐与 PBKDF2-HMAC-SHA256 60万次。管理员仍采用配置演示账号，不提供独立工作人员权限；本轮不提供短信/邮箱验证或密码找回。暂不支持删除工单、未绑定图片自动清理和多进程部署。

## Docker

配置好 `.env` 后：

```text
docker compose up --build -d
docker compose logs --tail 50 app
```

访问 127.0.0.1:8000。命名卷 `qinling_data` 同时保存数据库和图片，`docker compose down` 后再次启动可保留数据；**不要使用 `down -v`，它会删除卷数据**。镜像不包含 `.env`、本机数据或前端依赖目录。默认仅绑定本机，若团队需要局域网演示，自行将端口映射改成 `8000:8000` 并限制访问范围。部署同一 Git 提交与锁文件；没有服务器不影响本地交付。

本次环境未提供 Docker 引擎，Dockerfile/Compose 已交付，尚未在此机器完成容器构建与重建持久化验收。

## 团队目录与契约

```text
backend/app/             C：配置、数据库、业务、权限、上传和 AI 适配
backend/app/ai/          D：真实图像分析模块与模型客户端
backend/tests/           C：核心闭环和权限/异常测试
frontend/src/api/        C：生成类型、客户端、状态标签
frontend/src/features/visitor/  A：游客端
frontend/src/features/overview/ A：总览
frontend/src/features/journey/  沉浸式地图、景区、手记、回音和管理端
frontend/src/components/       A：公共视觉
frontend/public/assets/        独立生成的视觉素材与市级地图边界
scripts/browser_smoke.mjs      真实浏览器与隔离服务的闭环验收
scripts/live_upgrade_smoke.py  真实模型与升级浏览器闭环的独立验收
frontend/src/features/passport/        注册登录、探索印记、山河护照与原创SVG勋章
backend/app/visitor_auth.py / visitors.py  游客会话、私有记录与贡献审核
backend/app/rewards.py                幂等奖励、撤销明细与勋章条件
scripts/passport_browser.mjs          账号/过期草稿/同步/隐私/护照响应式验收
frontend/src/features/ecoproof/        游客证据卡与共同回音
frontend/src/features/ecoproof-admin/  管理员归并与整改核验
backend/app/image_fingerprints.py     SHA-256 / dHash 指纹工具
```

[团队任务索引](docs/团队任务/README.md) · [D 接入说明](docs/AI_INTEGRATION.md) · [C 交付记录](docs/DELIVERY.md)

修改共享模型/路由后执行：

```text
uv run python -m scripts.export_openapi
npm --prefix frontend run generate:types
uv run pytest backend/tests backend/tests_ai -q
uv run ruff check backend scripts
npm --prefix frontend run build
```

浏览器验收先执行 `npm --prefix frontend exec -- playwright install chromium`，再运行 `npm --prefix frontend run test:e2e`。本机若已有 Chrome，可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 为浏览器绝对路径。脚本启动独立随机端口与临时数据目录，不写入演示数据库，不使用真实 API Key；实际验证 AI 不可用时的保留材料和人工闭环，不伪造成功。截图写入忽略的 `data/browser-evidence/`。新增浏览器 CI 配置准备在 [浏览器 CI 建议](docs/浏览器CI建议.yml)，尚未启用：当前上传凭证不允许修改 workflow，仓库原有 CI 保持运行。

依赖以 `uv.lock`、`frontend/package-lock.json` 锁定。TypeScript 固定 5.9.3，以满足 openapi-typescript 的 peer 约束；不要绕过锁文件自行升级。真实图像分析按 [D 契约](docs/AI_INTEGRATION.md) 接入并单独验收。单元测试中的 TestProvider 是明确标注的测试替身，不会在运行应用中加载。

游客护照专项浏览器验收：`node scripts/passport_browser.mjs`。该脚本使用两个独立浏览器账户、同账号第二浏览器与同浏览器多标签页，验证注册继续原操作、登录过期保留草稿、私有图片与记录隔离、旧记录导入、退出切换及五种屏幕宽度；测试不使用真实密钥。

本轮交付：[游客护照使用说明](docs/游客护照契约与使用说明.md) · [升级验收、截图与真实模型记录](docs/游客护照升级验收.md)。
