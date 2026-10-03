import json
import secrets
from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Query, Request, Security

from .cases import touch_case
from .db import encode, materials_match, now
from .errors import APIError
from .models import Action, CreatedEvent, CreateEvent, Event, EventList, Overview, Status
from .security import admin_scheme, digest, event_actor, require_admin, visitor_scheme
from .uploads import claim_images

router = APIRouter()
POINTS = [
    {
        "id": "trail-entrance",
        "scenic_id": "qinling-demo",
        "name": "秦岭示范步道·入口",
        "availability": "demo",
        "label": "示范点位（非真实运营接入）",
    },
    {
        "id": "rest-area",
        "scenic_id": "qinling-demo",
        "name": "秦岭示范步道·休息区",
        "availability": "demo",
        "label": "示范点位（非真实运营接入）",
    },
    {
        "id": "planned",
        "scenic_id": "qinling-plan",
        "name": "山间步道拓展点",
        "availability": "planned",
        "label": "规划展示",
    },
    {
        "id": "terracotta-entry",
        "scenic_id": "terracotta-demo",
        "name": "兵马俑示范区·参观入口",
        "availability": "demo",
        "label": "示范点位（非真实运营接入）",
    },
    {
        "id": "terracotta-rest",
        "scenic_id": "terracotta-demo",
        "name": "兵马俑示范区·休息区",
        "availability": "demo",
        "label": "示范点位（非真实运营接入）",
    },
]
# Keep legacy point IDs stable while adding the four new scenic chapters.
for scenic_slug, scenic_name in (
    ("huashan", "华山"),
    ("baotashan", "宝塔山"),
    ("hanzhong", "汉中油菜花海"),
    ("zhenbeitai", "镇北台"),
):
    POINTS.extend(
        {
            "id": f"{scenic_slug}-{suffix}",
            "scenic_id": f"{scenic_slug}-demo",
            "name": f"{scenic_name}示范区·{name}",
            "availability": "demo",
            "label": "示范点位（非真实运营接入）",
        }
        for suffix, name in (("entry", "参观入口"), ("rest", "休息区"))
    )

TRANSITIONS = {
    "request_info": ({"pending_review"}, "needs_info"),
    "supplement": ({"needs_info"}, "pending_review"),
    "assign": ({"pending_review"}, "processing"),
    "submit_resolution": ({"processing"}, "pending_acceptance"),
    "return": ({"pending_acceptance"}, "processing"),
    "close": ({"pending_acceptance"}, "closed"),
    "reject": ({"needs_info", "pending_review"}, "rejected"),
}


@router.post("/events", response_model=CreatedEvent, status_code=201)
def create_event(body: CreateEvent, request: Request):
    if not any(
        p["id"] == body.point_id
        and p["scenic_id"] == body.scenic_id
        and p["availability"] == "demo"
        for p in POINTS
    ):
        raise APIError(422, "invalid_point", "请选择可操作的示范点位")
    db = request.app.state.db
    event_id, token, timestamp = uuid4().hex, secrets.token_urlsafe(32), now()
    with db.transaction() as conn:
        images = claim_images(conn, body.original_images, event_id)
        conn.execute(
            "INSERT INTO events(id,token_hash,scenic_id,point_id,description,original_images,"
            "status,is_demo,material_version,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,'pending_review',?,1,?,?)",
            (
                event_id,
                digest(token),
                body.scenic_id,
                body.point_id,
                body.description,
                encode(images),
                body.is_demo,
                timestamp,
                timestamp,
            ),
        )
        db.timeline(
            conn,
            event_id,
            "created",
            "visitor",
            body.description,
            None,
            "pending_review",
            {"images": images, "is_demo": body.is_demo},
        )
        return {"event": db.event(conn, event_id), "query_token": token}


@router.get("/events", response_model=EventList, dependencies=[Security(admin_scheme)])
def list_events(
    request: Request,
    status: Status | None = None,
    point_id: str | None = None,
    assignee: str | None = None,
    is_demo: bool | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    db = request.app.state.db
    with db.connect() as conn:
        require_admin(request, conn)
        clauses, values = ["merged_into IS NULL"], []
        for field, value in (
            ("status", status),
            ("point_id", point_id),
            ("assignee", assignee),
            ("is_demo", is_demo),
        ):
            if value is not None:
                clauses.append(f"{field}=?")
                values.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        total = conn.execute("SELECT COUNT(*) FROM events" + where, values).fetchone()[0]
        rows = conn.execute(
            "SELECT id FROM events" + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [*values, limit, offset],
        ).fetchall()
        return {
            "items": [db.event(conn, row["id"], admin=True) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@router.get(
    "/events/{event_id}",
    response_model=Event,
    dependencies=[Security(admin_scheme), Security(visitor_scheme)],
)
def event_detail(event_id: str, request: Request):
    db = request.app.state.db
    with db.connect() as conn:
        actor = event_actor(request, conn, db.row(conn, event_id))
        return db.event(conn, event_id, admin=actor == "admin")


@router.post(
    "/events/{event_id}/actions",
    response_model=Event,
    dependencies=[Security(admin_scheme), Security(visitor_scheme)],
)
def take_action(event_id: str, body: Action, request: Request):
    db = request.app.state.db
    with db.transaction() as conn:
        # Check role before validating action fields, avoiding accidental visitor privilege.
        if body.action != "supplement":
            require_admin(request, conn)
        row = db.row(conn, event_id)
        actor = event_actor(request, conn, row)
        if row["merged_into"] and body.action != "supplement":
            raise APIError(409, "linked_submission", "此线索已归并，请在主事件处理或撤销归并")
        if row["merged_into"] and db.row(conn, row["merged_into"])["status"] in {
            "closed",
            "rejected",
        }:
            raise APIError(409, "case_finished", "关联事件已结束，请重新投稿")
        allowed, target = TRANSITIONS[body.action]
        if row["status"] not in allowed:
            raise APIError(409, "invalid_transition", "当前状态不允许此操作")
        if (
            body.action in {"request_info", "return", "close", "reject", "submit_resolution"}
            and not body.note
        ):
            raise APIError(422, "note_required", "请填写处理或复核说明")
        changes, evidence = {}, {}
        if body.action == "assign":
            if not body.assignee:
                raise APIError(422, "assignee_required", "请指定责任人")
            changes["assignee"] = body.assignee
            evidence["assignee"] = body.assignee
        if body.action == "supplement":
            if not body.description and not body.original_images:
                raise APIError(422, "supplement_required", "请补充描述或照片")
            originals = json.loads(row["original_images"])
            if len(originals) + len(body.original_images) > 5:
                raise APIError(422, "too_many_images", "原图总数不能超过 5 张")
            added = claim_images(conn, body.original_images, event_id)
            changes["original_images"] = encode(originals + added)
            changes["description"] = body.description or row["description"]
            changes["material_version"] = row["material_version"] + 1
            evidence = {"images": added, "description": changes["description"]}
            touch_case(conn, row)
        if body.action == "submit_resolution":
            if not body.resolution_images or not row["assignee"]:
                raise APIError(422, "resolution_required", "整改需要责任人、照片与说明")
            images = claim_images(conn, body.resolution_images, event_id)
            changes.update(
                resolution_images=encode(images),
                resolution_note=body.note,
                material_version=row["material_version"] + 1,
            )
            evidence = {"images": images, "note": body.note, "assignee": row["assignee"]}
        if body.action in {"close", "return", "reject"}:
            changes["review_note"] = body.note
        if body.action == "close":
            latest = conn.execute(
                "SELECT * FROM analyses WHERE event_id=? AND kind='resolution' "
                "ORDER BY version DESC LIMIT 1",
                (event_id,),
            ).fetchone()
            result = json.loads(latest["result"]) if latest and latest["result"] else {}
            ai_assisted = (
                latest
                and latest["status"] == "succeeded"
                and materials_match(json.loads(latest["input_snapshot"]), row, "resolution")
                and result.get("suggestion") == "recommend_accept"
                and not result.get("same_image")
            )
            evidence["acceptance_mode"] = "ai_assisted_manual" if ai_assisted else "manual"
            evidence["analysis_id"] = latest["id"] if ai_assisted else None
        changes.update(status=target, updated_at=now(), revision=row["revision"] + 1)
        assignments = ",".join(f"{key}=?" for key in changes)
        conn.execute(f"UPDATE events SET {assignments} WHERE id=?", [*changes.values(), event_id])
        db.timeline(
            conn,
            event_id,
            body.action,
            actor,
            ("人工验收：" + body.note)
            if body.action == "close" and evidence.get("acceptance_mode") == "manual"
            else body.note or body.description,
            row["status"],
            target,
            evidence,
        )
        return db.event(conn, event_id, admin=actor == "admin")


@router.get("/overview", response_model=Overview)
def overview(request: Request):
    db = request.app.state.db
    start = datetime.now(timezone(timedelta(hours=8))).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = start + timedelta(days=1)
    with db.connect() as conn:
        by_status = dict.fromkeys(Status, 0)
        for row in conn.execute(
            "SELECT status,COUNT(*) AS n FROM events WHERE merged_into IS NULL GROUP BY status"
        ):
            by_status[row["status"]] = row["n"]
        count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE created_at>=? AND created_at<?",
            (start.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat()),
        ).fetchone()[0]
        demo = conn.execute(
            "SELECT COUNT(*) FROM events WHERE is_demo=1 AND merged_into IS NULL"
        ).fetchone()[0]
        counts = {
            r["point_id"]: r["n"]
            for r in conn.execute(
                "SELECT point_id,COUNT(*) AS n FROM events "
                "WHERE merged_into IS NULL GROUP BY point_id"
            )
        }
        return {
            "total": sum(by_status.values()),
            "submission_count": conn.execute("SELECT COUNT(*) FROM events").fetchone()[0],
            "today_count": count,
            "closed_count": by_status[Status.closed],
            "demo_count": demo,
            "by_status": by_status,
            "points": [{**p, "event_count": counts.get(p["id"], 0)} for p in POINTS],
        }
