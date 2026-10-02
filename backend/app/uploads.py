import hashlib
import secrets
import warnings
from io import BytesIO
from uuid import uuid4

from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from .db import now
from .errors import APIError
from .models import UploadResponse
from .security import digest, matches

router = APIRouter()


def normalize_image(content: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as img:
                if img.format not in ("JPEG", "PNG", "WEBP"):
                    raise APIError(415, "unsupported_image", "仅支持 JPEG、PNG 和 WebP 图片")
                if img.width * img.height > 20_000_000:
                    raise APIError(413, "too_many_pixels", "图片不能超过 2000 万像素")
                img.load()
                img = ImageOps.exif_transpose(img).convert("RGB")
                clean = Image.new("RGB", img.size)
                clean.paste(img)
                output = BytesIO()
                clean.save(output, "JPEG", quality=90)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise APIError(415, "invalid_image", "文件不是可读取的图片") from exc


@router.post("/uploads", response_model=UploadResponse, status_code=201)
async def upload(request: Request, file: UploadFile):
    limit = request.app.state.settings.max_upload_bytes
    try:
        content = await file.read(limit + 1)
    finally:
        await file.close()
    if len(content) > limit:
        raise APIError(413, "upload_too_large", "图片大小超过上传限制")
    encoded = await run_in_threadpool(normalize_image, content)
    db = request.app.state.db
    image_id, token = uuid4().hex, secrets.token_urlsafe(32)
    path = db.images / f"{image_id}.jpg"
    sha = hashlib.sha256(encoded).hexdigest()
    try:
        path.write_bytes(encoded)
        with db.transaction() as conn:
            duplicate = conn.execute(
                "SELECT 1 FROM uploads WHERE sha256=? LIMIT 1", (sha,)
            ).fetchone()
            conn.execute(
                "INSERT INTO uploads VALUES(?,?,?,?,?,?,NULL,?)",
                (image_id, path.name, "image/jpeg", len(encoded), sha, digest(token), now()),
            )
    except BaseException:
        # Retain the image on persistence failure; project files are never auto-deleted.
        raise
    return {
        "id": image_id,
        "url": f"/api/images/{image_id}",
        "content_type": "image/jpeg",
        "size": len(encoded),
        "upload_token": token,
        "duplicate_hint": bool(duplicate),
    }


@router.get("/images/{image_id}")
def image(request: Request, image_id: str):
    db = request.app.state.db
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM uploads WHERE id=?", (image_id,)).fetchone()
    if row is None or not (db.images / row["path"]).is_file():
        raise APIError(404, "image_not_found", "图片不存在")
    return FileResponse(
        db.images / row["path"],
        media_type=row["content_type"],
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


def claim_images(conn, claims, event_id):
    images = []
    for claim in claims:
        row = conn.execute("SELECT * FROM uploads WHERE id=?", (claim.id,)).fetchone()
        if row is None or not matches(claim.upload_token, row["token_hash"]):
            raise APIError(403, "invalid_upload_token", "图片上传凭证无效")
        if row["event_id"]:
            raise APIError(409, "image_already_claimed", "图片已绑定，请重新上传")
        conn.execute("UPDATE uploads SET event_id=? WHERE id=?", (event_id, claim.id))
        images.append(
            {
                "id": row["id"],
                "url": f"/api/images/{row['id']}",
                "content_type": row["content_type"],
                "size": row["size"],
            }
        )
    return images
