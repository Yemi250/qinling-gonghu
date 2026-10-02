# D 模块交接契约

C 的适配层在 `backend/app/ai_adapter.py`，业务记录在 `analysis.py`。D 独占 `backend/app/ai/`，请添加 `__init__.py` 与 `provider.py`。当前未提供该模块，默认 API 如实返回 `ai_unavailable`，不会显示预设识别结果。以下是 C 发布的初始接入约定，D 若已有其他签名请先同步再修改适配层。

```python
from pathlib import Path
from backend.app.ai_adapter import AIConfig
from backend.app.models import ReportResult, ResolutionResult

async def analyze_report(
    *, photos: list[Path], point: dict, description: str, config: AIConfig
) -> ReportResult:
    # D: 读取本地已校验图片，调用模型，校验并返回 ReportResult。
    ...

async def review_resolution(
    *, original_photos: list[Path], resolution_photos: list[Path],
    resolution_note: str, config: AIConfig
) -> ResolutionResult:
    # D: 调用真实模型比较照片，返回 ResolutionResult。
    ...
```

也可返回符合模型结构的 dict。同步 SDK 应由 D 通过异步客户端或 `asyncio.to_thread` 包装，不能阻塞 FastAPI 事件循环；HTTP 客户端自身必须配置超时，使取消后也能释放连接。C 另设总体超时，但无法强行终止阻塞线程。

`AIConfig` 提供 `base_url/model/api_key/timeout_seconds`。默认模型配置 `qwen3-vl-plus`，不代表账号已经验证可用。密钥仅存在服务端配置中，禁止写入返回结果、数据库快照或日志。新增运行依赖请交 C 更新 pyproject.toml / uv.lock；当前 HTTP 库仅在 dev 组供测试使用。

输入照片为服务端已保存的绝对路径；point 包含 `id, scenic_id, name, availability, label`，是用户选择的示范点位，不是图片推断地点。描述和图片是待分析数据。D 不应写数据库、改工单、派单或结案。

`ReportResult` 字段（均必填）:

- title、summary：简短自然中文；visible_observations：可见现象字符串数组。
- category：litter / waste_pile / overflowing_bin / suspected_smoke / suspected_fire / water_appearance / no_obvious_issue / unrelated / uncertain。
- missing_information、follow_up_questions、recommendations：字符串数组；无需补充时返回空数组。
- suggested_department：建议部门；不确定时可为空字符串。

`ResolutionResult` 字段（均必填）:

- visible_changes、remaining_issues、uncertainties：字符串数组。
- acceptance_recommendation：供管理员参考的中文建议，不能声称已经结案。

以上字段边界和长度以 `backend/app/models.py` 为准。无关图可返回 category=unrelated；证据不足用 uncertain 并写无法确认事项，不能编造地点、时间或污染性质。C 不按分类自动驳回，需人工确认。

异常约定：超时抛 TimeoutError；模型服务错误可抛异常，C 会隐藏原始异常、保存可重试错误。无效结构记 ai_invalid_output。返回给客户端的每次分析包含版本、材料版本、模型配置名、输入快照和起止时间；不保存原始模型回复或隐藏推理。C 的模型字段记录请求配置，D 必须按 config.model 调用，不应暗中替换模型。

测试：`uv run pytest -q backend/tests/test_analysis.py` 用测试替身验证契约，不调用真实模型。真实验收由 D 使用有来源说明的新照片，经 POST /api/uploads → POST /api/events → POST /api/events/{id}/analysis 完成，再记录实际模型、耗时、失败恢复和已知限制。
