# 秦岭共护

**让每一次发现，都有一个回应。** AI 驱动的景区生态共治原型，从一个示范景区、一条步道开始：游客提供线索，AI 整理信息，景区人工处置并反馈。

目前交付 **C：后端接口与集成 v0.1.0**。上传、存储、游客凭证、演示账号、状态流转、时间线和真实记录统计已实现。React 页面是联调入口，A/B 的产品界面与 D 的真实 AI 模块尚未集成；不能将此版本称为完整 AI 产品。没有真实客户接入或治理成效声明。

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

访问 [联调页面](http://127.0.0.1:8000)、[交互 API 文档](http://127.0.0.1:8000/docs) 或 [健康检查](http://127.0.0.1:8000/api/health)。后端同时提供 API、图片和前端构建产物，刷新 SPA 子路由仍可返回页面。未构建前端时后端 API 也可使用。

前端开发可在另一终端执行 `npm --prefix frontend run dev`，打开 [Vite](http://127.0.0.1:5173)，其 `/api` 代理至 8000。无需开放宽泛 CORS。正常运行仅用一个后端 worker；重启恢复逻辑不支持多个 worker 共享任务。

## 跑通一次闭环

可在 `/docs` 逐个请求，或运行真实 HTTP 验证脚本 `uv run python -m scripts.smoke`（使用临时目录、自行启动并重启后端，不污染演示数据）。该脚本使用人工闭环，AI 缺失如实记录失败。

1. `POST /api/uploads` 上传照片，保存 `id`、`upload_token`。
2. `POST /api/events` 填入 `scenic_id=qinling-demo`、`point_id=trail-entrance`、描述及图片凭证；演示素材带 `is_demo=true`。保存返回的 `query_token`。
3. `POST /api/events/{id}/analysis`，body 为 `{"kind":"report"}`，携带 `X-Visitor-Token`。D 模块未接入时返回 503，事件仍存在，可重试或人工处理。
4. `POST /api/auth/login` 登录。后续管理员请求带 `Authorization: Bearer <access_token>`。
5. `/actions` 依次调用 assign（assignee）、submit_resolution（新上传的 resolution_images 和 note）、close（人工验收 note）。必要时 request_info → supplement，或验收 return → 再次整改。
6. 游客用 `GET /api/events/{id}` 和自己的查询凭证查看材料、状态、复核说明与时间线。其他游客凭证无权访问，游客不能派单或结案。

字段、响应、状态矩阵和错误格式见 [API 清单](docs/API.md)；[OpenAPI 快照](docs/openapi.json) 与前端生成类型一起提交。

## 配置与数据

| 配置 | 含义 |
|---|---|
| DEMO_ADMIN_USERNAME / DEMO_ADMIN_PASSWORD | 管理员演示账号，密码不写入数据库或前端 |
| DATA_DIR | SQLite 和图片目录，默认仓库 data/ |
| AI_BASE_URL / AI_MODEL / AI_API_KEY | 仅服务端使用，默认百炼兼容地址和 qwen3-vl-plus；真实可用性由 D 验证 |
| AI_TIMEOUT_SECONDS | 单次分析总超时，默认 60 秒 |
| MAX_UPLOAD_BYTES | 单张上传上限，默认 10 MiB；另限 2000 万像素 |

`data/events.sqlite3` 保存事件、会话哈希、上传绑定、时间线和分析版本；`data/images/` 保存去除元信息后的 JPEG。**重启不会清空数据。** 备份时先停服务，复制整个 DATA_DIR（包括 SQLite WAL/SHM 如存在），恢复后使用相同版本启动。源码升级不能删除此目录。空库不会自动灌入业务记录。

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
backend/app/ai/          D：待交付的真实分析模块（签名见交接文档）
backend/tests/           C：核心闭环和权限/异常测试
frontend/src/api/        C：生成类型、客户端、状态标签
frontend/src/features/visitor/  A：游客端
frontend/src/features/overview/ A：总览
frontend/src/components/       A：公共视觉
frontend/src/features/admin/   B：管理端
```

[团队任务索引](docs/团队任务/README.md) · [D 接入说明](docs/AI_INTEGRATION.md) · [C 交付记录](docs/DELIVERY.md)

修改共享模型/路由后执行：

```text
uv run python -m scripts.export_openapi
npm --prefix frontend run generate:types
uv run pytest -q
uv run ruff check backend scripts
npm --prefix frontend run build
```

依赖以 `uv.lock`、`frontend/package-lock.json` 锁定。TypeScript 固定 5.9.3，以满足 openapi-typescript 的 peer 约束；不要绕过锁文件自行升级。真实图像分析按 [D 契约](docs/AI_INTEGRATION.md) 接入并单独验收。单元测试中的 TestProvider 是明确标注的测试替身，不会在运行应用中加载。
