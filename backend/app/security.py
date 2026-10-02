import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Request
from fastapi.security import APIKeyHeader, HTTPBearer

from .db import now
from .errors import APIError

admin_scheme = HTTPBearer(auto_error=False, scheme_name="AdminSession")
visitor_scheme = APIKeyHeader(name="X-Visitor-Token", auto_error=False, scheme_name="VisitorToken")


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def matches(token: str, hashed: str) -> bool:
    return secrets.compare_digest(digest(token), hashed)


def admin_token(request: Request, conn) -> str | None:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    row = conn.execute(
        "SELECT expires_at FROM sessions WHERE token_hash=?", (digest(token),)
    ).fetchone()
    if row and row["expires_at"] > now():
        return token
    return None


def require_admin(request: Request, conn):
    token = admin_token(request, conn)
    if not token:
        raise APIError(401, "unauthorized", "请先登录管理员演示账号")
    return token


def event_actor(request: Request, conn, row) -> str:
    if admin_token(request, conn):
        return "admin"
    token = request.headers.get("X-Visitor-Token", "")
    if not token:
        raise APIError(401, "unauthorized", "请提供本事件查询凭证")
    if not matches(token, row["token_hash"]):
        raise APIError(403, "forbidden", "查询凭证不属于此事件")
    return "visitor"


def create_session(settings, conn, username, password):
    configured = settings.demo_admin_password
    if len(configured) < 12 or configured.startswith("replace-"):
        raise APIError(503, "admin_not_configured", "请在服务端配置至少 12 位演示账号密码")
    if not (
        secrets.compare_digest(digest(username), digest(settings.demo_admin_username))
        and secrets.compare_digest(digest(password), digest(configured))
    ):
        raise APIError(401, "invalid_credentials", "账号或密码不正确")
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(UTC) + timedelta(hours=settings.admin_session_hours)).isoformat()
    conn.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
    conn.execute("INSERT INTO sessions VALUES(?,?)", (digest(token), expires))
    return {"access_token": token, "token_type": "bearer", "expires_at": expires}
