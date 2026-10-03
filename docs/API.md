# 公共 API v0.1.0（C 维护）

前缀 `/api`，JSON 使用 snake_case；时间为 UTC ISO 8601。完整交互文档 `/docs`，机器契约 `/openapi.json`，前端类型生成至 `frontend/src/api/schema.d.ts`。字段变更先修改此文件与模型，再生成类型。

## 身份与错误

- `POST /api/auth/login`：`{"username":"admin","password":"环境变量配置的密码"}` → `{"access_token":"…","token_type":"bearer","expires_at":"…"}`。
- 管理员请求带 `Authorization: Bearer <access_token>`，会话 8 小时。`POST /api/auth/logout` 注销。
- 事件创建返回 `query_token`，仅返回一次。游客后续带 `X-Visitor-Token: <query_token>`；不要放 URL、日志或公开链接。凭证遗失无恢复接口。
- 未认证 401，越权 403，不存在 404，状态冲突 409，上传过大 413，非图片 415，字段错误 422，AI 不可用 503/超时 504。
- 统一错误：`{"error":{"code":"invalid_transition","message":"当前状态不允许此操作","retryable":false,"details":[]}}`。验证错误只包含字段路径与原因，不回显输入/密钥。

## 上传与创建

`POST /api/uploads`：multipart 的 `file` 字段，JPEG/PNG/WebP，最多 10 MiB、2000 万像素。服务端校验并重新编码去掉元信息。返回 201：

```json
{"id":"随机ID","url":"/api/images/随机ID","content_type":"image/jpeg","size":631,"duplicate_hint":false,"upload_token":"一次性绑定凭证"}
```

图片 URL 为不可枚举的公开能力链接，持有链接即可看图；不要上传敏感材料。图片绑定事件需要 ID 和 upload_token，不能使用他人图片 ID 抢占。重复图只提示，不丢弃。

`POST /api/events`：

```json
{"scenic_id":"qinling-demo","point_id":"trail-entrance","description":"入口垃圾桶旁散落垃圾","original_images":[{"id":"上传ID","upload_token":"上传凭证"}],"is_demo":true}
```

返回 201：`{"event":{...Event},"query_token":"游客凭证"}`。新建状态 `pending_review`，描述允许为空以便后续补充。最多 5 张图。示范点位来自 overview；规划点位不能上报。is_demo 默认为 false，演示素材请显式标 true。

## 私密旅途明信片（2026-10-03 新增）

- `POST /api/postcards`：上传后传 `{scenic_id, description, images:[{id,upload_token}]}`，景区为 `terracotta-demo` / `qinling-demo` / `huashan-demo` / `baotashan-demo` / `hanzhong-demo` / `zhenbeitai-demo`，仅一张图片；返回 201 `{postcard,query_token}`。
- `GET /api/postcards/{id}`：必须携带该明信片的 `X-Visitor-Token`，返回 `{id,scenic_id,description,images,created_at}`。缺凭证 401，错误凭证 403，不存在 404；响应不包含凭证哈希。
- 明信片与事件分开存储，图片凭证只能绑定一次。美景收藏不创建事件、不进入 AI 治理与管理员队列，也不改变 overview 的治理统计。
- 前端“我的足迹”只保存本浏览器的记录入口与访问凭证；照片和正文来自服务端。携带正确编号和原始凭证可在另一浏览器读取，系统不会重新签发丢失的凭证。图片依然使用随机公开能力链接，与既有上传契约一致。

## 查询与总览（事件）

六景区点位：兵马俑 `terracotta-entry` / `terracotta-rest`；太白山沿用 `trail-entrance` / `rest-area`；其余四景区各为 `<slug>-entry` / `<slug>-rest`，slug 对应 `huashan`、`baotashan`、`hanzhong`、`zhenbeitai`。事件创建必须同时匹配景区与点位；`planned` 仍仅作规划展示。现有路径、历史数据与凭证兼容；本轮证据分析与归并使用版本2增量迁移，具体见 [EcoProof升级契约](EcoProof升级契约.md)。

- `GET /api/events`：仅管理员；可选 `scenic_id`、`status`、`point_id`、`assignee`、`is_demo`、`limit`（1—100）、`offset`，返回 `{items,total,limit,offset}`。景区、点位、阶段条件取交集，在数据库分页前筛选；未知景区或不匹配的点位返回空列表，不退回全部景区。
- `GET /api/events/{id}`：管理员或该事件游客凭证。返回 Event：`id, scenic_id, point_id, description, original_images, status, assignee, resolution_images, resolution_note, review_note, is_demo, material_version, created_at, updated_at, timeline, analyses, ai_status`。
- `GET /api/overview`：公开聚合 `{total,today_count,closed_count,by_status,demo_count,points}`；today_count 按 Asia/Shanghai 日期。点位包含示范/规划标签、主事件 `event_count` 和待处理主事件 `pending_count`，不返回事件详情。待处理包含 pending_review、needs_info、processing、pending_acceptance，排除 closed、rejected 和归并子投稿。管理端按景区聚合点位 pending_count，导航数字不随当前点位/阶段筛选变化。
- `GET /api/health`：就绪状态、版本和是否构建前端，不包含配置秘密。

本轮 Event 追加 `revision, relationship_version, merged_into, proof, governance`。事件列表与总览的治理统计按主事件计算；`overview.submission_count` 统计全部投稿，`today_count` 继续统计当天投稿。游客只收到自己的材料和共同治理摘要，候选及其他投稿材料仅管理员可读。归并后原凭证有效，处理在主事件上进行。

## 动作

`POST /api/events/{id}/actions`，返回更新后的 Event。所有状态校验、材料绑定和时间线写入同一事务。附加字段与 action 对应：

| action | 可执行者 | 前置状态 → 后置状态 | 字段 |
|---|---|---|---|
| request_info | 管理员 | pending_review → needs_info | note 必填 |
| supplement | 本事件游客/管理员 | needs_info → pending_review | description 或 original_images 至少一个；图片追加 |
| assign | 管理员 | pending_review → processing | assignee 必填；note 可选 |
| submit_resolution | 管理员演示账号代工作人员 | processing → pending_acceptance | resolution_images 和 note 必填 |
| return | 管理员 | pending_acceptance → processing | note 必填 |
| close | 管理员 | pending_acceptance → closed | note 必填 |
| reject | 管理员 | pending_review/needs_info → rejected | note 必填 |

`needs_info/待补充`、`pending_review/待审核`、`processing/处理中`、`pending_acceptance/待验收`、`closed/已结案`、`rejected/已驳回`。禁止跳状态，已结束不可再改。返工保留历史整改证据，当前整改图在新提交时替换；时间线保留每次图片及说明。

## AI 集成与失败恢复

新增 `POST /api/events/{id}/proof` 返回202并持久化四阶段任务；`GET /api/events/{id}` 读取实际阶段、建议与过期状态。新增管理员专用 `/associations`、`/merge`、`/unmerge`，使用记录/关系版本防止覆盖新结果。完整请求与规则见 [EcoProof升级契约](EcoProof升级契约.md)。整改对比保留原 `/analysis` 路径，结果增加 suggestion、same_image、reviewed_images、before_total；同图检查记录为 `system:sha256` 而非模型调用。关联变化也会使旧整改核验过期。

`POST /api/events/{id}/analysis`：`{"kind":"report"}` 或 `{"kind":"resolution"}`。请求等待一次分析结束；客户端超时后先 GET 事件，避免盲目重发。

- report 允许本事件游客或管理员在 needs_info/pending_review 发起；resolution 仅管理员在 pending_acceptance 发起。
- 成功 200 返回 Event，失败返回上述 error，GET 仍可查到原事件、材料、失败版本。AI 状态为 `not_started/running/succeeded/failed`，与业务状态分离。
- 同事件正在分析返回 409。每次尝试追加版本，不创建新事件。结果记录输入快照、材料版本、模型标识、开始/结束时间、结构化结果或可恢复错误。
- 成功 report 的 missing_information 非空且材料仍为当前版本时，由 C 将 pending_review 转为 needs_info；AI 永不派单/结案。分析期间人工操作可继续，旧材料结果标 stale，不改变新状态。
- 服务重启将未结束调用标记失败；超时可重试。运行方式限定单 worker，避免多个进程互相恢复任务。
- 没有 D 模块时如实返回 `ai_unavailable`；测试替身仅在测试注入，不用于应用运行。

D 集成签名与输出字段见 `docs/AI_INTEGRATION.md`。A/B 应以 `analyses` 的对应 kind 中最新 `stale=false` 记录为准展示；失败时保留历史成功意见并明确标注。material_version 是全局材料修订审计号，不能仅凭它判断某种分析已过期。stale 按该种分析实际输入判断：report 只比较原图、点位和描述；resolution 比较原图、整改图和整改说明，因此提交整改不会使原始事件卡分析过期。管理员可在 AI 失败时人工审核并将理由写入 note。
