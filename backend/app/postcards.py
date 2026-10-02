"""Private travel memories never create environmental events or affect their statistics."""

import json
import secrets
from uuid import uuid4

from fastapi import APIRouter, Request, Security

from .db import encode, now
from .errors import APIError
from .models import CreatedPostcard, CreatePostcard, Postcard
from .security import digest, matches, visitor_scheme
from .uploads import claim_images

router = APIRouter()


@router.post("/postcards", response_model=CreatedPostcard, status_code=201)
def create_postcard(body: CreatePostcard, request: Request):
    """Save a scenic photo and return its private retrieval capability once."""
    db = request.app.state.db
    identifier, token = uuid4().hex, secrets.token_urlsafe(32)
    timestamp = now()
    with db.transaction() as conn:
        images = claim_images(conn, body.images, f"postcard:{identifier}")
        conn.execute(
            "INSERT INTO postcards VALUES(?,?,?,?,?,?)",
            (
                identifier,
                digest(token),
                body.scenic_id,
                body.description,
                encode(images),
                timestamp,
            ),
        )
    return {
        "postcard": {
            "id": identifier,
            "scenic_id": body.scenic_id,
            "description": body.description,
            "images": images,
            "created_at": timestamp,
        },
        "query_token": token,
    }


@router.get(
    "/postcards/{identifier}", response_model=Postcard, dependencies=[Security(visitor_scheme)]
)
def get_postcard(identifier: str, request: Request):
    """Read a private memory only with its matching visitor credential."""
    token = request.headers.get("X-Visitor-Token", "")
    if not token:
        raise APIError(401, "unauthorized", "请提供这张明信片的查询凭证")
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM postcards WHERE id=?", (identifier,)).fetchone()
    if row is None:
        raise APIError(404, "not_found", "明信片不存在")
    if not matches(token, row["token_hash"]):
        raise APIError(403, "forbidden", "查询凭证不属于这张明信片")
    return {
        "id": row["id"],
        "scenic_id": row["scenic_id"],
        "description": row["description"],
        "images": json.loads(row["images"]),
        "created_at": row["created_at"],
    }
