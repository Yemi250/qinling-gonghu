import asyncio
import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Request, Security
from pydantic import ValidationError

from .ai_adapter import AIConfig
from .db import encode, materials_match, now
from .errors import APIError
from .events import POINTS
from .models import AnalyzeRequest, Event, ReportResult, ResolutionResult
from .security import admin_scheme, event_actor, require_admin, visitor_scheme

router = APIRouter()


@router.post(
    "/events/{event_id}/analysis",
    response_model=Event,
    dependencies=[Security(admin_scheme), Security(visitor_scheme)],
)
async def analyze(event_id: str, body: AnalyzeRequest, request: Request):
    db, settings = request.app.state.db, request.app.state.settings
    kind, run_id = body.kind, uuid4().hex
    with db.transaction() as conn:
        if kind == "resolution":
            require_admin(request, conn)
        row = db.row(conn, event_id)
        event_actor(request, conn, row)
        allowed = {"needs_info", "pending_review"} if kind == "report" else {"pending_acceptance"}
        if row["status"] not in allowed:
            raise APIError(409, "invalid_analysis_state", "当前状态不允许此类分析")
        running = conn.execute(
            "SELECT * FROM analyses WHERE event_id=? AND status='running'", (event_id,)
        ).fetchall()
        for old in running:
            elapsed = (
                datetime.now(UTC) - datetime.fromisoformat(old["started_at"])
            ).total_seconds()
            if elapsed <= settings.ai_timeout_seconds + 5:
                raise APIError(
                    409, "analysis_running", "已有分析正在执行，请稍后查询", retryable=True
                )
            db.fail_run(conn, old, "ai_timeout", "上次分析已超时，可重新分析")
        snapshot = {
            "original_images": json.loads(row["original_images"]),
            "resolution_images": json.loads(row["resolution_images"]),
            "description": row["description"],
            "point_id": row["point_id"],
            "resolution_note": row["resolution_note"],
        }
        paths = {}
        for key in ("original_images", "resolution_images"):
            paths[key] = []
            for image in snapshot[key]:
                stored = conn.execute(
                    "SELECT path FROM uploads WHERE id=?", (image["id"],)
                ).fetchone()
                if stored is None or not (db.images / stored["path"]).is_file():
                    raise APIError(409, "missing_image", "原始图片文件缺失，请检查数据目录")
                paths[key].append(db.images / stored["path"])
        version = conn.execute(
            "SELECT COALESCE(MAX(version),0)+1 FROM analyses WHERE event_id=?", (event_id,)
        ).fetchone()[0]
        material_version = row["material_version"]
        conn.execute(
            "INSERT INTO analyses(id,event_id,version,kind,material_version,"
            "status,model,started_at,"
            "input_snapshot) VALUES(?,?,?,?,?,'running',?,?,?)",
            (
                run_id,
                event_id,
                version,
                kind,
                material_version,
                settings.ai_model,
                now(),
                encode(snapshot),
            ),
        )
        db.timeline(
            conn,
            event_id,
            "analysis_started",
            "ai",
            "AI 生态风险识别开始",
            row["status"],
            row["status"],
            {"analysis_id": run_id, "kind": kind, "version": version},
        )

    config = AIConfig(
        settings.ai_base_url, settings.ai_model, settings.ai_api_key, settings.ai_timeout_seconds
    )
    failure, result = None, None
    try:
        async with asyncio.timeout(settings.ai_timeout_seconds):
            if kind == "report":
                point = next(p.copy() for p in POINTS if p["id"] == snapshot["point_id"])
                raw = await request.app.state.ai.analyze_report(
                    photos=paths["original_images"],
                    point=point,
                    description=snapshot["description"],
                    config=config,
                )
                result = ReportResult.model_validate(raw).model_dump()
            else:
                raw = await request.app.state.ai.review_resolution(
                    original_photos=paths["original_images"],
                    resolution_photos=paths["resolution_images"],
                    resolution_note=snapshot["resolution_note"],
                    config=config,
                )
                result = ResolutionResult.model_validate(raw).model_dump()
    except TimeoutError:
        failure = APIError(504, "ai_timeout", "AI 分析超时，材料已保存，请稍后重试", retryable=True)
    except ValidationError:
        failure = APIError(
            502, "ai_invalid_output", "AI 返回结构无效，材料已保存，可重试", retryable=True
        )
    except APIError as exc:
        # Provider messages may contain credentials or raw responses; do not return them.
        code = "ai_unavailable" if exc.info.code == "ai_unavailable" else "ai_failed"
        failure = APIError(503, code, "AI 暂不可用，材料已保存，可重试或人工处理", retryable=True)
    except asyncio.CancelledError:
        with db.transaction() as conn:
            run = conn.execute("SELECT * FROM analyses WHERE id=?", (run_id,)).fetchone()
            if run["status"] == "running":
                db.fail_run(conn, run, "ai_interrupted", "分析被中断，材料已保存，请重试")
        raise
    except Exception:
        failure = APIError(
            502, "ai_failed", "AI 调用失败，材料已保存，可重试或人工处理", retryable=True
        )

    with db.transaction() as conn:
        run = conn.execute("SELECT * FROM analyses WHERE id=?", (run_id,)).fetchone()
        if run["status"] != "running":
            raise APIError(
                409, "analysis_superseded", "此分析已过期，请查询最新结果", retryable=True
            )
        current = db.row(conn, event_id)
        if failure:
            db.fail_run(conn, run, failure.info.code, failure.info.message)
        else:
            conn.execute(
                "UPDATE analyses SET status='succeeded',result=?,finished_at=? WHERE id=?",
                (encode(result), now(), run_id),
            )
            target = current["status"]
            if (
                kind == "report"
                and result["missing_information"]
                and materials_match(snapshot, current, kind)
                and target == "pending_review"
            ):
                target = "needs_info"
                conn.execute(
                    "UPDATE events SET status=?,updated_at=? WHERE id=?", (target, now(), event_id)
                )
            db.timeline(
                conn,
                event_id,
                "analysis_succeeded",
                "ai",
                "AI 意见仅供参考，派单和结案需人工确认",
                current["status"],
                target,
                {"analysis_id": run_id, "version": version},
            )
        response = db.event(conn, event_id)
    if failure:
        raise failure
    return response
