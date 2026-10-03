import asyncio
import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Request, Security
from pydantic import ValidationError

from .ai_adapter import AIConfig
from .cases import group_rows, image_digests, review_materials
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
        actor = event_actor(request, conn, row)
        if row["merged_into"]:
            raise APIError(409, "linked_submission", "此线索已归并，请在主事件进行核验")
        if kind == "report":
            proof = conn.execute(
                "SELECT id FROM proof_runs WHERE event_id=? AND status='running'", (event_id,)
            ).fetchone()
            if proof and getattr(request.state, "proof_run_id", None) != proof["id"]:
                raise APIError(409, "proof_running", "证据分析正在执行，请稍后读取结果")
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
        same_image = False
        before_total = len(snapshot["original_images"])
        if kind == "resolution":
            selected, before_total = review_materials(conn, row)
            snapshot["group_images"] = selected
            snapshot["relationship_version"] = row["relationship_version"]
            before_hashes = {u["sha256"] for _, u in image_digests(conn, group_rows(conn, row))}
            after_hashes = {
                conn.execute("SELECT sha256 FROM uploads WHERE id=?", (i["id"],)).fetchone()[0]
                for i in snapshot["resolution_images"]
            }
            same_image = bool(after_hashes) and after_hashes <= before_hashes
        paths = {}
        for key in ("original_images", "resolution_images"):
            paths[key] = []
            selected_images = (
                snapshot.get("group_images", snapshot[key])
                if key == "original_images"
                else snapshot[key]
            )
            for image in selected_images:
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
                "system:sha256" if same_image else settings.ai_model,
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
        settings.ai_base_url,
        settings.ai_model,
        settings.ai_api_key,
        settings.ai_timeout_seconds,
        log_path=str(settings.data_dir / "ai_calls.jsonl"),
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
                if same_image:
                    raw = ResolutionResult(
                        visible_changes=[],
                        remaining_issues=[],
                        uncertainties=["整改照片与整改前照片完全重复，未提供新的整改证据"],
                        acceptance_recommendation="无法依据重复照片确认整改，请补充新照片或人工现场验收。",
                        suggestion="need_human",
                        same_image=True,
                    )
                else:
                    raw = await request.app.state.ai.review_resolution(
                        original_photos=paths["original_images"],
                        resolution_photos=paths["resolution_images"],
                        resolution_note=snapshot["resolution_note"],
                        config=config,
                    )
                result = ResolutionResult.model_validate(raw).model_dump()
                result.update(
                    same_image=same_image,
                    reviewed_images=[]
                    if same_image
                    else snapshot.get("group_images", snapshot["original_images"]),
                    before_total=before_total,
                )
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
                    "UPDATE events SET status=?,updated_at=?,revision=revision+1 WHERE id=?",
                    (target, now(), event_id),
                )
            db.timeline(
                conn,
                event_id,
                "analysis_succeeded",
                "ai",
                "同图检查完成，未调用模型，需补充整改证据"
                if same_image
                else "AI 意见仅供参考，派单和结案需人工确认",
                current["status"],
                target,
                {"analysis_id": run_id, "version": version},
            )
        response = db.event(conn, event_id, admin=actor == "admin")
    if failure:
        raise failure
    return response
