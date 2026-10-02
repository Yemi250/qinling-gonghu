"""Bound actual bytes before multipart parsing, including HTTP chunked requests."""

from starlette.responses import JSONResponse


class RequestBodyLimit:
    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = (
            self.settings.max_upload_bytes + 1024 * 1024
            if scope["path"] == "/api/uploads"
            else 1024 * 1024
        )
        buffered = bytearray()
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
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
                    headers={
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                    },
                )
                return await response(scope, receive, send)
            buffered.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            body = bytes(buffered)
            buffered.clear()
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)
