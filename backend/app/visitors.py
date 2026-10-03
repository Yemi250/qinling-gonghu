"""Visitor accounts, personal passports, deliberate legacy import and contribution review."""

import json
import sqlite3
from collections import defaultdict
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter, Query, Request, Response

from .db import now
from .errors import APIError
from .rewards import SCENICS, contribution_facts, passport, reconcile_all
from .security import matches, require_admin
from .visitor_auth import (
    DUMMY_PASSWORD_HASH,
    VISITOR_COOKIE,
    password_hash,
    password_matches,
    public_user,
    require_visitor,
    same_origin,
    start_session,
    token_digest,
    visitor,
)
from .visitor_models import (
    ContributionDecision,
    ContributionStatus,
    ImportRecords,
    ImportResult,
    Passport,
    PersonalRecords,
    Register,
    RewardHistory,
    VisitorLogin,
    VisitorSession,
)

router = APIRouter()


def throttle(request: Request):
    """Bound account creation and login attempts within the documented single-worker server."""
    buckets = request.app.state.visitor_attempts
    key = (request.url.path, request.client.host if request.client else "unknown")
    current = monotonic()
    for existing in list(buckets):
        buckets[existing] = [t for t in buckets[existing] if current - t < 60]
        if not buckets[existing]:
            del buckets[existing]
    if len(buckets[key]) >= 10:
        raise APIError(429, "visitor_rate_limited", "尝试过于频繁，请稍后再试", retryable=True)
    buckets[key].append(current)


def new_attempt_buckets():
    """Keep throttling state on each app rather than sharing test and preview instances."""
    return defaultdict(list)


@router.post("/visitor/register", response_model=VisitorSession, status_code=201)
def register(body: Register, request: Request, response: Response):
    """Create a real visitor account and start its independent session."""
    same_origin(request)
    throttle(request)
    if body.password != body.confirm_password:
        raise APIError(422, "password_mismatch", "两次输入的密码不一致")
    db = request.app.state.db
    with db.transaction() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=?", (body.username,)).fetchone():
            raise APIError(409, "username_taken", "这个用户名已经有人使用，请换一个")
        user_id = uuid4().hex
        try:
            conn.execute(
                "INSERT INTO users VALUES(?,?,?,?,?)",
                (
                    user_id,
                    body.username,
                    body.nickname.strip() or body.username,
                    password_hash(body.password),
                    now(),
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise APIError(409, "username_taken", "这个用户名已经有人使用，请换一个") from exc
        csrf = start_session(
            request.app.state.settings,
            conn,
            response,
            user_id,
            secure=request.url.scheme == "https",
        )
        user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"user": public_user(user), "csrf_token": csrf}


@router.post("/visitor/login", response_model=VisitorSession)
def login(body: VisitorLogin, request: Request, response: Response):
    """Authenticate only persisted visitor accounts, without administrator privileges."""
    same_origin(request)
    throttle(request)
    with request.app.state.db.transaction() as conn:
        user = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        # An unknown username still incurs the normal password derivation cost.
        stored = user["password_hash"] if user else DUMMY_PASSWORD_HASH
        if not password_matches(body.password, stored) or not user:
            raise APIError(401, "invalid_visitor_credentials", "用户名或密码不正确")
        csrf = start_session(
            request.app.state.settings,
            conn,
            response,
            user["id"],
            secure=request.url.scheme == "https",
        )
        return {"user": public_user(user), "csrf_token": csrf}


@router.get("/visitor/me", response_model=VisitorSession)
def me(request: Request):
    """Allow the public shell to discover signed-in identity without treating guests as errors."""
    with request.app.state.db.connect() as conn:
        user = visitor(request, conn)
        return {
            "user": public_user(user) if user else None,
            "csrf_token": user["csrf_token"] if user else None,
        }


@router.post("/visitor/logout", status_code=204)
def logout(request: Request, response: Response):
    """Revoke the current visitor session and leave the administrator session untouched."""
    with request.app.state.db.transaction() as conn:
        require_visitor(request, conn, write=True)
        conn.execute(
            "DELETE FROM visitor_sessions WHERE token_hash=?",
            (token_digest(request.cookies.get(VISITOR_COOKIE, "")),),
        )
    response.delete_cookie(VISITOR_COOKIE, path="/api")


@router.get("/visitor/me/passport", response_model=Passport)
def personal_passport(request: Request):
    """Read real persisted participation and badge state for this account only."""
    with request.app.state.db.connect() as conn:
        user = require_visitor(request, conn)
        return passport(conn, user["id"])


@router.post("/visitor/explore/{scenic_id}", response_model=Passport)
def explore(scenic_id: str, request: Request):
    """Record an online exploration stamp once; this is not a geographic check-in."""
    if scenic_id not in SCENICS:
        raise APIError(422, "unknown_scenic", "请选择已有景区篇章")
    with request.app.state.db.transaction() as conn:
        user = require_visitor(request, conn, write=True)
        conn.execute(
            "INSERT OR IGNORE INTO explorations VALUES(?,?,?)", (user["id"], scenic_id, now())
        )
        reconcile_all(conn)
        return passport(conn, user["id"])


@router.get("/visitor/me/records", response_model=PersonalRecords)
def records(
    request: Request,
    kind: str | None = Query(None, pattern="^(memory|care)$"),
    scenic_id: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Filter owned records before pagination; expose no other visitor materials."""
    with request.app.state.db.connect() as conn:
        user = require_visitor(request, conn)
        sql = """SELECT * FROM (
          SELECT p.id,'memory' kind,p.scenic_id,p.description title,p.images photos,
                 p.created_at,NULL status,p.owner_id FROM postcards p
          UNION ALL
          SELECT e.id,'care',e.scenic_id,e.description,e.original_images,e.created_at,
                 COALESCE(root.status,e.status),e.owner_id FROM events e
          LEFT JOIN events root ON root.id=e.merged_into
        ) WHERE owner_id=?"""
        params = [user["id"]]
        for field, value in (("kind", kind), ("scenic_id", scenic_id)):
            if value is not None:
                sql += f" AND {field}=?"
                params.append(value)
        total = conn.execute("SELECT COUNT(*) FROM (" + sql + ")", params).fetchone()[0]
        rows = conn.execute(
            sql + " ORDER BY created_at DESC,id LIMIT ? OFFSET ?", [*params, limit, offset]
        ).fetchall()
        return {
            "items": [
                {
                    "id": r["id"],
                    "kind": r["kind"],
                    "scenic_id": r["scenic_id"],
                    "title": r["title"],
                    "image": json.loads(r["photos"])[0]["url"],
                    "created_at": r["created_at"],
                    "status": r["status"],
                }
                for r in rows
            ],
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@router.get("/visitor/me/rewards", response_model=RewardHistory)
def reward_history(
    request: Request, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)
):
    """Return the account's positive and negative adjustments, with actual reasons and dates."""
    with request.app.state.db.connect() as conn:
        user = require_visitor(request, conn)
        sql = "FROM reward_changes c JOIN rewards r ON r.id=c.reward_id WHERE r.user_id=?"
        total = conn.execute("SELECT COUNT(*) " + sql, (user["id"],)).fetchone()[0]
        rows = conn.execute(
            "SELECT c.*,r.label " + sql + " ORDER BY c.id DESC LIMIT ? OFFSET ?",
            (user["id"], limit, offset),
        ).fetchall()
        return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.post("/visitor/me/import", response_model=list[ImportResult])
def import_records(body: ImportRecords, request: Request):
    """Claim only unowned legacy records with their matching original retrieval capability."""
    results = []
    with request.app.state.db.transaction() as conn:
        user = require_visitor(request, conn, write=True)
        for claim in body.records:
            table = "events" if claim.kind == "care" else "postcards"
            row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (claim.id,)).fetchone()
            ok = bool(
                row
                and row["legacy_access"]
                and matches(claim.query_token, row["token_hash"])
                and row["owner_id"] in (None, user["id"])
            )
            if ok:
                conn.execute(f"UPDATE {table} SET owner_id=? WHERE id=?", (user["id"], claim.id))
            results.append(
                {
                    "id": claim.id,
                    "kind": claim.kind,
                    "imported": ok,
                    "message": "已导入我的护照" if ok else "凭证无效或记录已有归属，未导入",
                }
            )
        reconcile_all(conn)
    return results


def contribution_status(conn, event_id):
    """Explain contribution eligibility separately from the governance workflow status."""
    fact = next((f for f in contribution_facts(conn) if f["id"] == event_id), None)
    if not fact:
        raise APIError(404, "event_not_found", "事件不存在")
    row = conn.execute(
        "SELECT note FROM contribution_reviews WHERE event_id=?", (event_id,)
    ).fetchone()
    return {
        "decision": fact["decision"],
        "independent": fact["independent"],
        "valid": fact["valid"],
        "account_record": bool(fact["owner_id"]),
        "note": row[0] if row else "",
    }


@router.get("/events/{event_id}/contribution", response_model=ContributionStatus)
def get_contribution(event_id: str, request: Request):
    """Let administrators inspect review and duplicate status without exposing account identity."""
    with request.app.state.db.connect() as conn:
        require_admin(request, conn)
        return contribution_status(conn, event_id)


@router.post("/events/{event_id}/contribution", response_model=ContributionStatus)
def review_contribution(event_id: str, body: ContributionDecision, request: Request):
    """Explicitly approve/correct individual contributions with revision protection and audit."""
    db = request.app.state.db
    with db.transaction() as conn:
        require_admin(request, conn)
        event = db.row(conn, event_id)
        if event["revision"] != body.revision:
            raise APIError(409, "event_changed", "事件已变化，请刷新后审核贡献")
        timestamp = now()
        conn.execute(
            "INSERT INTO contribution_reviews VALUES(?,?,?,?) ON CONFLICT(event_id) "
            "DO UPDATE SET decision=excluded.decision,note=excluded.note,"
            "updated_at=excluded.updated_at",
            (event_id, body.decision, body.note.strip(), timestamp),
        )
        conn.execute("UPDATE events SET revision=revision+1 WHERE id=?", (event_id,))
        db.timeline(
            conn,
            event_id,
            "contribution_review",
            "admin",
            body.note,
            event["status"],
            event["status"],
            {"decision": body.decision},
        )
        reconcile_all(conn)
        return contribution_status(conn, event_id)
