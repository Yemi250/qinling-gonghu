# 秦岭共护

**山河有回响，等你来一趟。** 面向景区运营团队与游客的 AI 环境共护原型：从陕西漫游地图出发，游客收藏旅途照片，记录需要照看的地方；AI 整理环境线索，景区工作人员审核、派单、上传处理照片并人工验收。

当前包含陕西十市地图与六个可操作篇章：兵马俑、太白山、华山、宝塔山、汉中油菜花海、镇北台。六景区共用导航、首屏比例和随行手记，各有独立意境与配色；支持私密照片收藏、环境共护记录和景区工作台。照片收藏独立存储，不生成治理工单。全部点位均为示范点位，未正式接入真实景区。

本轮新增 **EcoProof 证据分析、共同治理事件归并、AI 整改核验**。模型整理照片依据；系统区分重复图片与不同图片；管理员对照候选确认归并、处理与验收。各份游客原凭证仍可查看共同回音，不显示虚构真实性百分比，不把投稿数当作人数。

本机硅基流动 `Qwen/Qwen3-VL-30B-A3B-Instruct` 已通过真实识图、不同角度关联比对、整改前后对比、保存与浏览器刷新验收。最新一轮 5 次上游调用成功，另有 2 次网络失败经页面重试恢复；同图整改负例由系统检查拦截，没有调用模型。测试图片明确标注为模拟场景，连接与流程通过不代表实际准确率或真实整改效果。见 [EcoProof升级验收](docs/EcoProof升级验收.md) 与 [升级契约](docs/EcoProof升级契约.md)。此前六景区记录保留于 [六景区体验与模型验收](docs/六景区体验与模型验收.md)。

## 体验路线

1. 首页悬停或聚焦六个地标，查看目的地便笺；点击地标或便笺进入对应景区，移开恢复默认兵马俑介绍。搜索可按景区名或城市名查找六个目的地。
2. 翻开“随行手记”：**留住这一刻**上传照片并保存私密明信片；**一起照看这里**保存照片、描述与点位，再发起真实 AI 分析。
3. 在“我的足迹”查看收藏与共护回音。刷新页面仍可读取服务端记录；在记录页展开访问凭证，可抄下完整编号和凭证，用于另一浏览器找回。
4. 页脚进入“景区工作台”，用本地环境配置中的管理账号登录，完成补充信息、派单、整改照片、AI 前后对比及人工验收。
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

1. `POST /api/uploads` 上传照片，保存 `id`、`upload_token`。
2. `POST /api/events` 填入 `scenic_id=qinling-demo`、`point_id=trail-entrance`、描述及图片凭证；演示素材带 `is_demo=true`。保存返回的 `query_token`。
3. `POST /api/events/{id}/proof`，携带 `X-Visitor-Token`，返回 202。随后 GET 读取真实材料检查、内容分析、关联比对、处置建议。未配置或调用失败时保留已完成阶段和材料，可重试或人工处理；既有 `/analysis` 路径保持兼容。
4. `POST /api/auth/login` 登录。后续管理员请求带 `Authorization: Bearer <access_token>`。
5. `/actions` 依次调用 assign（assignee）、submit_resolution（新上传的 resolution_images 和 note）、close（人工验收 note）。必要时 request_info → supplement，或验收 return → 再次整改。
6. 游客用 `GET /api/events/{id}` 和自己的查询凭证查看材料、状态、复核说明与时间线。其他游客凭证无权访问，游客不能派单或结案。

字段、响应、状态矩阵和错误格式见 [API 清单](docs/API.md)；[OpenAPI 快照](docs/openapi.json) 与前端生成类型一起提交。

## 配置与数据

| 配置 | 含义 |
|---|---|
| DEMO_ADMIN_USERNAME / DEMO_ADMIN_PASSWORD | 管理员演示账号，密码不写入数据库或前端 |
| DATA_DIR | SQLite 和图片目录，默认仓库 data/ |
| AI_BASE_URL / AI_MODEL / AI_API_KEY | 仅服务端使用，默认百炼兼容地址和 qwen3-vl-plus；需配置可用模型凭据 |
| AI_TIMEOUT_SECONDS | 单次分析总超时，默认 60 秒 |
| MAX_UPLOAD_BYTES | 单张上传上限，默认 10 MiB；另限 2000 万像素 |

`data/events.sqlite3` 保存事件、私密明信片、会话哈希、上传绑定、时间线、分析版本及证据任务；`data/images/` 保存去除元信息后的 JPEG。**重启不会清空数据。** 本轮迁移至数据库版本2，旧版本1库升级前自动使用 SQLite backup 备份到 `DATA_DIR/backups/`，保留原材料和凭证。备份图片仍需停服务并复制完整 DATA_DIR（包括 WAL/SHM 如存在），恢复时使用匹配版本代码。源码升级不能删除此目录。空库不会自动灌入业务记录。

图片展示 URL 是随机公开链接，持有链接可看图。游客凭证是单事件访问能力，仅创建时返回一次，不要放 URL 或日志。账号由全体演示管理员/工作人员共用，没有独立工作人员权限、密码找回或生产身份系统。暂不支持删除工单、未绑定图片自动清理和多进程部署。

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
