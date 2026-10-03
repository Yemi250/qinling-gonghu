"""Persisted EcoProof stages and admin-only association decisions, driven by real results."""

import asyncio
import json
from uuid import uuid4

from fastapi import APIRouter, Request, Security

from . import analysis
from .ai_adapter import AIConfig
from .cases import (
    current_report,
    group_rows,
    image_digests,
    merge_submission,
    recent_roots,
    review_materials,
    undo_merge,
)
from .db import encode, now
from .errors import APIError
from .events import POINTS
from .models import (
    AnalyzeRequest,
    AssociationView,
    CandidateMatch,
    Event,
    MergeRequest,
    ProofView,
    UnmergeRequest,
)
from .security import admin_scheme, event_actor, require_admin, visitor_scheme

router = APIRouter()
STAGES = ("material", "content", "association", "decision")


def update_step(db, run_id, key, state, message, evidence=()):
    """Commit each completed operation so refresh reflects actual backend progress."""
    with db.transaction() as conn:
        row = conn.execute("SELECT steps FROM proof_runs WHERE id=?", (run_id,)).fetchone()
        steps = json.loads(row["steps"])
        for step in steps:
            if step["key"] == key:
                step.update(state=state, message=message, evidence=list(evidence))
        conn.execute("UPDATE proof_runs SET steps=? WHERE id=?", (encode(steps), run_id))


def evidence(label, value, source="system"):
    """Tag evidence with the producer instead of treating user input as verification."""
    return {"label": label, "value": str(value), "source": source}


def check_snapshot(db, conn, run_id, *, allow_linked=False):
    """Reject late decisions after a human changes materials, associations or governance."""
    run = conn.execute("SELECT * FROM proof_runs WHERE id=?", (run_id,)).fetchone()
    row = db.row(conn, run["event_id"])
    if (
        run["material_version"] != row["material_version"]
        or run["relationship_version"] != row["relationship_version"]
        or (row["merged_into"] and not allow_linked)
        or row["status"] not in {"pending_review", "needs_info"}
    ):
        raise APIError(409, "proof_stale", "材料、关联或处理状态已变化，请刷新后重试")
    return row


def fingerprint_candidates(db, source):
    """Rank at most three nearby-in-workflow cases using exact bytes, dHash and category."""
    from .image_fingerprints import compute_fingerprint, hamming_distance

    with db.transaction() as conn:
        _, source_report = current_report(conn, source)
        own_images = image_digests(conn, [source])
        pool = []
        for target in recent_roots(conn, source):
            report_id, report = current_report(conn, target)
            if not report:
                continue
            photos = image_digests(conn, group_rows(conn, target))
            source_hashes = {u["sha256"] for _, u in own_images}
            target_hashes = {u["sha256"] for _, u in photos}
            exact = bool(source_hashes) and source_hashes <= target_hashes
            distances = []
            for _, stored in own_images + photos:
                if not stored["dhash"]:
                    fingerprint = compute_fingerprint(db.images / stored["path"])
                    stored["dhash"] = fingerprint.dhash
                    conn.execute(
                        "UPDATE uploads SET dhash=? WHERE id=?", (fingerprint.dhash, stored["id"])
                    )
            for _, left in own_images:
                for _, right in photos:
                    distances.append(hamming_distance(left["dhash"], right["dhash"]))
            distance = min(distances, default=64)
            waste = {"litter", "waste_pile", "overflowing_bin"}
            same_category = source_report and (
                source_report["category"] == report["category"]
                or {source_report["category"], report["category"]} <= waste
            )
            if not exact and distance > 6 and not same_category:
                continue
            reviewed, _ = review_materials(conn, target)
            pool.append(
                {
                    "id": target["id"],
                    "title": report["title"],
                    "point_id": target["point_id"],
                    "created_at": target["created_at"],
                    "version": target["revision"],
                    "source_revision": source["revision"],
                    "source_report_id": current_report(conn, source)[0],
                    "target_report_id": report_id,
                    "exact": exact,
                    "dhash_distance": distance,
                    "submission_count": len(group_rows(conn, target)),
                    "unique_image_count": len(target_hashes),
                    "images": reviewed,
                    "description": target["description"],
                }
            )
        pool.sort(key=lambda c: (not c["exact"], c["dhash_distance"], c["created_at"], c["id"]))
        return pool[:3]


async def compare_candidate(request, source, candidate):
    """Call the real provider for different photos; exact duplicates use deterministic evidence."""
    if candidate["exact"]:
        return {
            "relation": "same_issue",
            "reasons": ["原图字节与已有材料完全重复"],
            "uncertainties": ["重复照片不构成独立拍摄或真实性证明"],
        }
    db, settings = request.app.state.db, request.app.state.settings
    with db.connect() as conn:
        source_images = json.loads(source["original_images"])[:2]
        target_images = candidate["images"][:2]

        def paths(images):
            """Resolve only previously persisted, token-claimed images."""
            return [
                db.images
                / conn.execute("SELECT path FROM uploads WHERE id=?", (i["id"],)).fetchone()["path"]
                for i in images
            ]

        left, right = paths(source_images), paths(target_images)
    config = AIConfig(
        settings.ai_base_url,
        settings.ai_model,
        settings.ai_api_key,
        settings.ai_timeout_seconds,
        str(settings.data_dir / "ai_calls.jsonl"),
    )
    async with asyncio.timeout(settings.ai_timeout_seconds):
        result = await request.app.state.ai.compare_reports(
            source_photos=left,
            target_photos=right,
            source_description=source["description"],
            target_description=candidate["description"],
            config=config,
        )
    return CandidateMatch.model_validate(result).model_dump()


async def run_proof(request, event_id, run_id):
    """Advance one saved submission through material, content, association and decision stages."""
    db = request.app.state.db
    key = None
    association_failed = False
    try:
        key = "material"
        update_step(db, run_id, key, "running", "正在检查已保存材料")
        with db.connect() as conn:
            source = dict(check_snapshot(db, conn, run_id))
            images = image_digests(conn, [source])
            if not images or any(not (db.images / u["path"]).is_file() for _, u in images):
                raise APIError(409, "missing_image", "图片材料缺失，请检查数据目录")
        update_step(
            db,
            run_id,
            key,
            "pass",
            "图片已保存，点位配置有效",
            [
                evidence("照片", f"{len(images)} 张已保存图片"),
                evidence(
                    "点位来源",
                    next(p["name"] for p in POINTS if p["id"] == source["point_id"]),
                    "visitor",
                ),
                evidence("时间来源", f"服务端收到投稿：{source['created_at']}"),
                evidence("无法确认", "未验证拍摄地点、拍摄时间或照片真实性"),
            ],
        )
        key = "content"
        update_step(db, run_id, key, "running", "视觉模型正在整理可见问题")
        request.state.proof_run_id = run_id
        await analysis.analyze(event_id, AnalyzeRequest(kind="report"), request)
        with db.connect() as conn:
            source = dict(check_snapshot(db, conn, run_id))
            _, report = current_report(conn, source)
        if not report:
            raise APIError(409, "proof_stale", "分析材料已变化，请重新分析")
        update_step(
            db,
            run_id,
            key,
            "attention" if report.get("verdict") != "ok" else "pass",
            report["summary"],
            [
                evidence("可见类别", report["category"], "model"),
                *[evidence("可见依据", x, "model") for x in report["visible_observations"]],
                *[evidence("需补充", x, "model") for x in report["missing_information"]],
            ],
        )
        key = "association"
        update_step(db, run_id, key, "running", "正在查找同点位近期线索")
        candidates = []
        merged = False
        if report.get("verdict") in {"ok", "need_info", "uncertain"}:
            candidates = await asyncio.to_thread(fingerprint_candidates, db, source)
            for candidate in candidates:
                try:
                    candidate.update(await compare_candidate(request, source, candidate))
                except (TimeoutError, Exception):
                    association_failed = True
                    candidate.update(
                        relation="uncertain",
                        reasons=[],
                        uncertainties=["模型关联比对未完成，请人工查看材料"],
                    )
                candidate.pop("description", None)
            with db.transaction() as conn:
                check_snapshot(db, conn, run_id)
                conn.execute(
                    "UPDATE proof_runs SET candidates=? WHERE id=?", (encode(candidates), run_id)
                )
                if not association_failed:
                    for candidate in candidates:
                        if not candidate["exact"]:
                            continue
                        try:
                            merge_submission(
                                db,
                                conn,
                                event_id,
                                candidate["id"],
                                reason="同点位近期完全重复照片已归并；不计作独立印证",
                                actor="system",
                                source_revision=candidate["source_revision"],
                                target_revision=candidate["version"],
                                automatic=True,
                            )
                            source = dict(db.row(conn, event_id))
                            conn.execute(
                                "UPDATE proof_runs SET relationship_version=? WHERE id=?",
                                (source["relationship_version"], run_id),
                            )
                            merged = True
                            break
                        except APIError:
                            continue
        state = "failed" if association_failed else "attention" if candidates else "pass"
        message = (
            "同点位完全重复照片已归并"
            if merged
            else "关联比对暂不可用，请人工复核"
            if association_failed
            else f"找到 {len(candidates)} 件候选，等待管理员确认"
            if candidates
            else "未找到符合范围的关联候选"
        )
        update_step(
            db,
            run_id,
            key,
            state,
            message,
            [
                evidence("比对范围", "同景区、同点位、同演示属性，最近投稿在2小时内"),
                evidence("重复照片", "不构成独立拍摄或人数证明"),
            ],
        )
        key = "decision"
        update_step(db, run_id, key, "running", "正在保存处置建议")
        if merged:
            kind, reason = "merge", "这份重复投稿已关联到共同治理事件，可继续查看回音。"
        elif association_failed:
            kind, reason = "human_review", "内容已分析，关联比对未完成，请人工复核。"
        elif report["category"] in {"no_obvious_issue", "unrelated"}:
            kind, reason = "no_issue", "未见可据此处理的环境问题，材料已保存。"
        elif report["missing_information"] or report.get("verdict") == "need_info":
            kind, reason = "supplement", "请补充模型指出的现场信息，帮助景区审核。"
        elif any(c["relation"] == "same_issue" for c in candidates):
            kind, reason = "merge", "存在可能关联的线索，请管理员查看依据后确认归并。"
        elif report.get("verdict") == "ok":
            kind, reason = "process", "存在可见环境线索，建议景区审核并安排处理。"
        else:
            kind, reason = "human_review", "现有材料仍有不确定性，请景区人工复核。"
        update_step(
            db,
            run_id,
            key,
            "attention" if kind in {"supplement", "human_review"} else "pass",
            reason,
            [evidence("建议部门", report["suggested_department"] or "人工确定", "model")],
        )
        with db.transaction() as conn:
            if not merged:
                check_snapshot(db, conn, run_id)
            conn.execute(
                "UPDATE proof_runs SET status=?,finished_at=?,conclusion=? WHERE id=?",
                (
                    "partial" if association_failed else "succeeded",
                    now(),
                    encode({"kind": kind, "reason": reason}),
                    run_id,
                ),
            )
    except asyncio.CancelledError:
        if key:
            update_step(db, run_id, key, "failed", "服务中断，材料已保存，可重试")
        with db.transaction() as conn:
            conn.execute(
                "UPDATE proof_runs SET status='failed',finished_at=?,error=? WHERE id=?",
                (now(), "服务中断，材料已保存，可重试", run_id),
            )
        raise
    except Exception as exc:
        message = (
            exc.info.message if isinstance(exc, APIError) else "证据分析未完成，材料已保存，可重试"
        )
        if key:
            update_step(db, run_id, key, "failed", message)
        with db.transaction() as conn:
            conn.execute(
                "UPDATE proof_runs SET status='failed',finished_at=?,error=? WHERE id=?",
                (now(), message, run_id),
            )


@router.post(
    "/events/{event_id}/proof",
    response_model=ProofView,
    status_code=202,
    dependencies=[Security(admin_scheme), Security(visitor_scheme)],
)
async def start_proof(event_id: str, request: Request):
    """Start or reuse a durable run; client disconnection does not cancel the retained task."""
    db = request.app.state.db
    with db.transaction() as conn:
        source = db.row(conn, event_id)
        event_actor(request, conn, source)
        if source["merged_into"] or source["status"] not in {"pending_review", "needs_info"}:
            raise APIError(409, "invalid_proof_state", "当前线索已关联或进入处理，请查看最新回音")
        running = conn.execute(
            "SELECT * FROM proof_runs WHERE event_id=? AND status='running'",
            (event_id,),
        ).fetchone()
        if running:
            return db.event(conn, event_id)["proof"]
        steps = [{"key": key, "state": "idle", "message": "", "evidence": []} for key in STAGES]
        run_id = uuid4().hex
        conn.execute(
            "INSERT INTO proof_runs(id,event_id,material_version,relationship_version,status,"
            "model,started_at,steps) VALUES(?,?,?,?,'running',?,?,?)",
            (
                run_id,
                event_id,
                source["material_version"],
                source["relationship_version"],
                request.app.state.settings.ai_model,
                now(),
                encode(steps),
            ),
        )
        result = db.event(conn, event_id)["proof"]
        lock_key = (source["point_id"], source["is_demo"])
    lock = request.app.state.proof_locks.setdefault(lock_key, asyncio.Lock())

    async def locked_run():
        """Serialize one point's matching decisions while unrelated points remain concurrent."""
        async with lock:
            await run_proof(request, event_id, run_id)

    task = asyncio.create_task(locked_run())
    request.app.state.proof_tasks.add(task)
    task.add_done_callback(request.app.state.proof_tasks.discard)
    return result


@router.get(
    "/events/{event_id}/associations",
    response_model=AssociationView,
    dependencies=[Security(admin_scheme)],
)
def associations(event_id: str, request: Request):
    """Admin-only candidates and group members; visitors never receive these photos."""
    db = request.app.state.db
    with db.connect() as conn:
        require_admin(request, conn)
        source = db.row(conn, event_id)
        proof = conn.execute(
            "SELECT * FROM proof_runs WHERE event_id=? ORDER BY started_at DESC LIMIT 1",
            (event_id,),
        ).fetchone()
        stale = not proof or proof["material_version"] != source["material_version"]
        stale = stale or proof["relationship_version"] != source["relationship_version"]
        candidates = json.loads(proof["candidates"]) if proof else []
        for candidate in candidates:
            target = db.row(conn, candidate["id"])
            candidate["stale"] = (
                stale
                or candidate["version"] != target["revision"]
                or candidate["source_revision"] != source["revision"]
                or current_report(conn, target)[0] != candidate["target_report_id"]
                or current_report(conn, source)[0] != candidate["source_report_id"]
            )
        rows = group_rows(conn, source)
        return {
            "candidates": candidates,
            "stale": stale,
            "members": [
                {
                    "id": r["id"],
                    "relationship_version": r["relationship_version"],
                    "description": r["description"],
                    "original_images": json.loads(r["original_images"]),
                }
                for r in rows
            ],
            "before_images": review_materials(conn, source)[0],
            "before_total": review_materials(conn, source)[1],
        }


@router.post(
    "/events/{event_id}/merge", response_model=Event, dependencies=[Security(admin_scheme)]
)
def merge(event_id: str, body: MergeRequest, request: Request):
    """Confirm only a fresh stored candidate using source and target revision guards."""
    db = request.app.state.db
    with db.transaction() as conn:
        require_admin(request, conn)
        source = db.row(conn, event_id)
        proof = conn.execute(
            "SELECT * FROM proof_runs WHERE event_id=? ORDER BY started_at DESC LIMIT 1",
            (event_id,),
        ).fetchone()
        if (
            not proof
            or proof["status"] != "succeeded"
            or proof["material_version"] != source["material_version"]
            or proof["relationship_version"] != source["relationship_version"]
        ):
            raise APIError(409, "proof_stale", "请先完成当前材料的证据分析")
        candidate = next(
            (
                c
                for c in json.loads(proof["candidates"])
                if c["id"] == body.target_event_id and c["relation"] != "different"
            ),
            None,
        )
        target = db.row(conn, body.target_event_id)
        if (
            not candidate
            or candidate["version"] != body.target_revision
            or candidate["source_revision"] != body.source_revision
            or current_report(conn, target)[0] != candidate["target_report_id"]
            or current_report(conn, source)[0] != candidate["source_report_id"]
        ):
            raise APIError(409, "candidate_changed", "候选或分析已变化，请重新比对")
        merge_submission(
            db,
            conn,
            event_id,
            body.target_event_id,
            reason=body.reason,
            actor="admin",
            source_revision=body.source_revision,
            target_revision=body.target_revision,
        )
        return db.event(conn, event_id, admin=True)


@router.post(
    "/events/{event_id}/unmerge", response_model=Event, dependencies=[Security(admin_scheme)]
)
def unmerge(event_id: str, body: UnmergeRequest, request: Request):
    """Undo a live relation with explicit reason and optimistic relation version."""
    db = request.app.state.db
    with db.transaction() as conn:
        require_admin(request, conn)
        undo_merge(db, conn, event_id, version=body.relationship_version, reason=body.reason)
        return db.event(conn, event_id, admin=True)
