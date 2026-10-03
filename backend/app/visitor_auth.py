"""Independent visitor authentication, same-origin writes and scoped private images."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Request

from .db import now
from .errors import APIError

VISITOR_COOKIE = "gonghu_visitor"
ADMIN_IMAGE_COOKIE = "gonghu_admin_images"


def token_digest(token: str) -> str:
    """Hash high-entropy session tokens; passwords use a separate slow function."""
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password: str, salt: str | None = None) -> str:
    """Persist a versioned PBKDF2 digest with an independent 16-byte random salt."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000)
    return f"pbkdf2_sha256$600000${salt}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    """Compare derived password digests without storing or returning clear-text passwords."""
    return secrets.compare_digest(password_hash(password, stored.split("$")[2]), stored)


# Equal derivation cost for unknown usernames; this value grants no account or session.
DUMMY_PASSWORD_HASH = password_hash(secrets.token_urlsafe(32))


def same_origin(request: Request):
    """Reject browser writes from foreign origins; direct API clients still require CSRF."""
    origin = request.headers.get("origin")
    if (origin and origin.rstrip("/") != str(request.base_url).rstrip("/")) or (
        request.headers.get("sec-fetch-site") == "cross-site"
    ):
        raise APIError(403, "foreign_origin", "请从本站页面发起操作")


def visitor(request: Request, conn):
    """Resolve only the visitor cookie, never an administrator token."""
    token = request.cookies.get(VISITOR_COOKIE, "")
    return (
        conn.execute(
            "SELECT u.*,s.csrf_token FROM visitor_sessions s JOIN users u ON u.id=s.user_id "
            "WHERE s.token_hash=? AND s.expires_at>?",
            (token_digest(token), now()),
        ).fetchone()
        if token
        else None
    )


def require_visitor(request: Request, conn, *, write=False):
    """Authenticate the account and require the session CSRF token for mutations."""
    user = visitor(request, conn)
    if not user:
        raise APIError(401, "visitor_login_required", "请登录后继续，当前内容会保留")
    if write:
        same_origin(request)
        if not secrets.compare_digest(request.headers.get("X-Gonghu-CSRF", ""), user["csrf_token"]):
            raise APIError(403, "invalid_csrf", "会话校验失败，请重新登录后继续")
    return user


def public_user(user):
    """Return display identity only; never expose password hashes or session secrets."""
    return {key: user[key] for key in ("id", "username", "nickname", "created_at")}


def record_access(request: Request, conn, row):
    """Use account ownership for new records and preserve legacy read capabilities."""
    user = visitor(request, conn)
    token = request.headers.get("X-Visitor-Token", "")
    valid_token = bool(token and secrets.compare_digest(token_digest(token), row["token_hash"]))
    if token and not valid_token:
        raise APIError(403, "forbidden", "查询凭证不属于此记录")
    if request.method != "GET":
        user = require_visitor(request, conn, write=True)
    if user and user["id"] == row["owner_id"]:
        return
    if row["legacy_access"] and valid_token and (request.method == "GET" or not row["owner_id"]):
        return
    if not user:
        raise APIError(401, "visitor_login_required", "请登录对应账号，或使用原匿名记录凭证")
    raise APIError(403, "forbidden", "这份记录不属于当前账号")


def start_session(settings, conn, response, user_id, *, secure=False):
    """Issue an opaque HttpOnly cookie and a distinct CSRF token for a seven-day session."""
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    lifetime = settings.visitor_session_hours * 3600
    expires = (datetime.now(UTC) + timedelta(seconds=lifetime)).isoformat()
    conn.execute(
        "INSERT INTO visitor_sessions VALUES(?,?,?,?)",
        (token_digest(token), user_id, csrf, expires),
    )
    response.set_cookie(
        VISITOR_COOKIE,
        token,
        max_age=lifetime,
        httponly=True,
        secure=settings.visitor_cookie_secure or secure,
        samesite="lax",
        path="/api",
    )
    return csrf
