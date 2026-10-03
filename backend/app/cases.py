"""Flat case associations: immutable submission ownership, shared governance, versioned changes."""

import json
from datetime import UTC, datetime, timedelta

from .db import materials_match, now
from .errors import APIError

ACTIVE_TARGETS = {"pending_review", "processing"}
SAFE_CATEGORIES = {"litter", "waste_pile", "overflowing_bin", "water_appearance"}


def group_rows(conn, row):
    """Get the root followed by its submissions; groups are deliberately one level deep."""
    root_id = row["merged_into"] or row["id"]
    root = conn.execute("SELECT * FROM events WHERE id=?", (root_id,)).fetchone()
    members = conn.execute(
        "SELECT * FROM events WHERE merged_into=? ORDER BY created_at DESC,id", (root_id,)
    ).fetchall()
    return [root, *members]


def image_digests(conn, rows):
    """Read original-image metadata and normalized byte digests without moving any image."""
    found = []
    for row in rows:
        for image in json.loads(row["original_images"]):
            upload = conn.execute("SELECT * FROM uploads WHERE id=?", (image["id"],)).fetchone()
            if upload:
                found.append((image, dict(upload)))
    return found


def review_materials(conn, row):
    """Select at most five distinct photos, preserving the root and then recent members."""
    found = image_digests(conn, group_rows(conn, row))
    unique = {}
    for image, stored in found:
        unique.setdefault(stored["sha256"], image)
    return list(unique.values())[:5], len(unique)


def governance_summary(conn, event):
    """Expose common milestones and counts, never another visitor's submission materials."""
    rows = group_rows(conn, event)
    if len(rows) == 1:
        return None
    root = rows[0]
    photos = image_digests(conn, rows)
    unique_count = len({upload["sha256"] for _, upload in photos})
    labels = {
        "created": "收到共同关注",
        "assign": "景区已接力处理",
        "submit_resolution": "已提交整改材料",
        "return": "正在继续完善",
        "close": "共同关注已有回音",
    }
    milestones = []
    closed_at = None
    for row in conn.execute("SELECT * FROM timeline WHERE event_id=? ORDER BY id", (root["id"],)):
        if row["action"] not in labels:
            continue
        milestones.append(
            {
                "label": labels[row["action"]],
                "created_at": row["created_at"],
                "note": row["note"] if row["action"] == "close" else "",
            }
        )
        if row["action"] == "close":
            closed_at = row["created_at"]
    return {
        "case_id": root["id"],
        "status": root["status"],
        "point_id": root["point_id"],
        "submission_count": len(rows),
        "unique_image_count": unique_count,
        "duplicate_image_count": len(photos) - unique_count,
        "milestones": milestones,
        "closed_at": closed_at,
        "closing_note": root["review_note"] if root["status"] == "closed" else None,
    }


def current_report(conn, row):
    """Return the newest successful report that still matches its original materials."""
    for run in conn.execute(
        "SELECT * FROM analyses WHERE event_id=? AND kind='report' AND status='succeeded' "
        "ORDER BY version DESC",
        (row["id"],),
    ):
        if materials_match(json.loads(run["input_snapshot"]), row, "report"):
            return run["id"], json.loads(run["result"])
    return None, None


def eligible_target(conn, source, target):
    """Apply point, time, demo segregation and active-root gates before any association."""
    if source["id"] == target["id"] or target["merged_into"]:
        return False
    if target["status"] not in ACTIVE_TARGETS:
        return False
    for key in ("point_id", "scenic_id", "is_demo"):
        if source[key] != target[key]:
            return False
    latest = max(datetime.fromisoformat(row["created_at"]) for row in group_rows(conn, target))
    return abs(datetime.fromisoformat(source["created_at"]) - latest) <= timedelta(hours=2)


def merge_submission(
    db,
    conn,
    source_id,
    target_id,
    *,
    reason,
    actor,
    source_revision=None,
    target_revision=None,
    automatic=False,
):
    """Associate an unassigned submission atomically; never copy ownership or auto-close."""
    source, target = db.row(conn, source_id), db.row(conn, target_id)
    if source_revision is not None and source_revision != source["revision"]:
        raise APIError(409, "source_changed", "线索已变化，请刷新后确认")
    if target_revision is not None and target_revision != target["revision"]:
        raise APIError(409, "target_changed", "目标事件已变化，请重新比对")
    if (
        source["merged_into"]
        or source["assignee"]
        or source["status"] not in {"pending_review", "needs_info"}
        or len(group_rows(conn, source)) != 1
        or not eligible_target(conn, source, target)
    ):
        raise APIError(409, "merge_not_allowed", "当前状态、点位或时间不允许归并")
    _, left = current_report(conn, source)
    _, right = current_report(conn, target)
    if automatic:
        left_images = {u["sha256"] for _, u in image_digests(conn, [source])}
        right_images = {u["sha256"] for _, u in image_digests(conn, group_rows(conn, target))}
        if (
            source["status"] != "pending_review"
            or not left
            or not right
            or left.get("verdict") != "ok"
            or right.get("verdict") != "ok"
            or left["category"] not in SAFE_CATEGORIES
            or left["category"] != right["category"]
            or not left_images
            or not left_images <= right_images
        ):
            raise APIError(409, "not_exact_duplicate", "未满足严格自动归并条件")
    timestamp = now()
    conn.execute(
        "UPDATE events SET merged_into=?,relationship_version=relationship_version+1,"
        "revision=revision+1,updated_at=? WHERE id=?",
        (target_id, timestamp, source_id),
    )
    conn.execute(
        "UPDATE events SET relationship_version=relationship_version+1,"
        "revision=revision+1,updated_at=? WHERE id=?",
        (timestamp, target_id),
    )
    # Existing member proof cards become stale through their changed relationship version.
    conn.execute(
        "UPDATE events SET relationship_version=relationship_version+1 WHERE merged_into=? "
        "AND id<>?",
        (target_id, source_id),
    )
    evidence = {"source_id": source_id, "target_id": target_id, "automatic": automatic}
    for row in (source, target):
        db.timeline(
            conn, row["id"], "merged", actor, reason, row["status"], row["status"], evidence
        )


def undo_merge(db, conn, source_id, *, version, reason):
    """Detach a submission, retaining the full audit trail and its original credentials."""
    source = db.row(conn, source_id)
    if source["relationship_version"] != version:
        raise APIError(409, "source_changed", "关联已变化，请刷新后重试")
    if not source["merged_into"]:
        raise APIError(409, "not_merged", "此线索尚未归并")
    target = db.row(conn, source["merged_into"])
    if target["status"] in {"closed", "rejected"}:
        raise APIError(409, "case_finished", "已结束事件的关联不可撤销")
    timestamp = now()
    conn.execute(
        "UPDATE events SET merged_into=NULL,relationship_version=relationship_version+1,"
        "revision=revision+1,updated_at=? WHERE id=?",
        (timestamp, source_id),
    )
    conn.execute(
        "UPDATE events SET relationship_version=relationship_version+1,revision=revision+1,"
        "updated_at=? WHERE id=? OR merged_into=?",
        (timestamp, target["id"], target["id"]),
    )
    for row in (source, target):
        db.timeline(
            conn,
            row["id"],
            "unmerged",
            "admin",
            reason,
            row["status"],
            row["status"],
            {"source_id": source_id},
        )


def touch_case(conn, row):
    """Invalidate grouped reviews when a member adds new original evidence."""
    if row["merged_into"]:
        conn.execute(
            "UPDATE events SET relationship_version=relationship_version+1,revision=revision+1,"
            "updated_at=? WHERE id=?",
            (now(), row["merged_into"]),
        )


def recent_roots(conn, source):
    """Limit expensive candidate matching to recent same-point active cases."""
    cutoff = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    rows = conn.execute(
        "SELECT * FROM events WHERE merged_into IS NULL AND id<>? AND point_id=? "
        "AND scenic_id=? AND is_demo=? AND status IN ('pending_review','processing') "
        "AND updated_at>=? ORDER BY created_at ASC,id LIMIT 50",
        (source["id"], source["point_id"], source["scenic_id"], source["is_demo"], cutoff),
    ).fetchall()
    return [r for r in rows if eligible_target(conn, source, r)]
