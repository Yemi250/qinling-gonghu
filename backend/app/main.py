from collections import defaultdict
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI, Request, Security
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException

from . import analysis, events, postcards, uploads
from .ai_adapter import ModuleAI
from .config import Settings
from .db import Database
from .errors import APIError
from .limits import RequestBodyLimit
from .models import ErrorResponse, Login, Session
from .security import admin_scheme, create_session, digest, require_admin


def create_app(settings: Settings | None = None, ai=None) -> FastAPI:
    settings = settings or Settings()
    db = Database(settings.data_dir)

    @asynccontextmanager
    async def lifespan(app):
        db.initialize()
        yield

    app = FastAPI(
        title="秦岭共护 API",
        version="0.1.0",
        lifespan=lifespan,
        responses={
            code: {"model": ErrorResponse}
            for code in (401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504)
        },
    )
    app.state.settings, app.state.db, app.state.ai = settings, db, ai or ModuleAI()
    login_attempts = defaultdict(list)

    @app.exception_handler(APIError)
    async def api_error(request, exc):
        return JSONResponse({"error": exc.info.model_dump()}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        details = [
            {"field": ".".join(map(str, e["loc"])), "reason": e["msg"]} for e in exc.errors()
        ]
        return JSONResponse(
            {
                "error": {
                    "code": "validation_error",
                    "message": "请求字段不符合约定",
                    "retryable": False,
                    "details": details,
                }
            },
            status_code=422,
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(
            {
                "error": {
                    "code": f"http_{exc.status_code}",
                    "message": "请求无法处理",
                    "retryable": False,
                    "details": [],
                }
            },
            status_code=exc.status_code,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        return JSONResponse(
            {
                "error": {
                    "code": "internal_error",
                    "message": "服务异常，请稍后重试",
                    "retryable": True,
                    "details": [],
                }
            },
            status_code=500,
        )

    @app.middleware("http")
    async def headers_and_limits(request: Request, call_next):
        length = request.headers.get("content-length", "0")
        limit = (
            settings.max_upload_bytes + 1024 * 1024
            if request.url.path == "/api/uploads"
            else 1024 * 1024
        )
        if length.isdigit() and int(length) > limit:
            response = JSONResponse(
                {
                    "error": {
                        "code": "request_too_large",
                        "message": "请求体超过大小限制",
                        "retryable": False,
                        "details": [],
                    }
                },
                status_code=413,
            )
        else:
            response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/images/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/auth/login", response_model=Session)
    def login(body: Login, request: Request):
        # In-process throttle is sufficient for the single-worker local demonstration.
        address = request.client.host if request.client else "unknown"
        current = monotonic()
        for key in list(login_attempts):
            login_attempts[key] = [t for t in login_attempts[key] if current - t < 60]
            if not login_attempts[key]:
                del login_attempts[key]
        if len(login_attempts[address]) >= 10:
            raise APIError(
                429, "login_rate_limited", "登录尝试过于频繁，请稍后重试", retryable=True
            )
        login_attempts[address].append(current)
        with db.transaction() as conn:
            session = create_session(settings, conn, body.username, body.password)
        login_attempts.pop(address, None)
        return session

    @app.post("/api/auth/logout", status_code=204, dependencies=[Security(admin_scheme)])
    def logout(request: Request):
        with db.transaction() as conn:
            token = require_admin(request, conn)
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))
        return Response(status_code=204)

    @app.get("/api/health")
    def health():
        with db.connect() as conn:
            conn.execute("SELECT 1").fetchone()
        return {
            "status": "ok",
            "version": "0.1.0",
            "frontend_built": (settings.frontend_dist / "index.html").is_file(),
        }

    app.include_router(uploads.router, prefix="/api")
    app.include_router(events.router, prefix="/api")
    app.include_router(analysis.router, prefix="/api")
    app.include_router(postcards.router, prefix="/api")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise APIError(404, "not_found", "API 不存在")
        root = settings.frontend_dist.resolve()
        target = (root / path).resolve()
        if not target.is_relative_to(root) or any(
            part.startswith(".") for part in path.split("/") if part
        ):
            raise APIError(404, "not_found", "页面不存在")
        if target.is_file():
            return FileResponse(target)
        if path.startswith("assets/") or (path and "." in path.split("/")[-1]):
            raise APIError(404, "not_found", "静态资源不存在")
        index = root / "index.html"
        if index.is_file():
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return JSONResponse({"message": "后端已启动，请构建 frontend 或打开 /docs 进行接口联调"})

    app.add_middleware(RequestBodyLimit, settings=settings)
    return app


app = create_app()
