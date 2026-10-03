"""Private travel memories never create environmental events or affect their statistics."""

import json
import secrets
from uuid import uuid4

from fastapi import APIRouter, Request, Security

from .db import encode, now
from .errors import APIError
from .models import CreatedPostcard, CreatePostcard, Postcard
from .rewards import reconcile_all
from .security import digest, visitor_scheme
from .uploads import claim_images
from .visitor_auth import record_access, require_visitor

router = APIRouter()


@router.post("/postcards", response_model=CreatedPostcard, status_code=201)
def create_postcard(body: CreatePostcard, request: Request):
    """Save an account-owned scenic memory, retaining the response shape for legacy callers."""
    db = request.app.state.db
    identifier, token = uuid4().hex, secrets.token_urlsafe(32)
    timestamp = now()
    with db.transaction() as conn:
        user = require_visitor(request, conn, write=True)
        images = claim_images(conn, body.images, f"postcard:{identifier}", owner_id=user["id"])
        conn.execute(
            "INSERT INTO postcards(id,token_hash,scenic_id,description,images,created_at,"
            "owner_id,legacy_access) VALUES(?,?,?,?,?,?,?,0)",
            (
                identifier,
                digest(token),
                body.scenic_id,
                body.description,
                encode(images),
                timestamp,
                user["id"],
            ),
        )
        reconcile_all(conn)
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
    """Read the owning account's memory, or a historical record's original capability."""
    with request.app.state.db.connect() as conn:
        row = conn.execute("SELECT * FROM postcards WHERE id=?", (identifier,)).fetchone()
        if row is not None:
            record_access(request, conn, row)
    if row is None:
        raise APIError(404, "not_found", "明信片不存在")
    return {
        "id": row["id"],
        "scenic_id": row["scenic_id"],
        "description": row["description"],
        "images": json.loads(row["images"]),
        "created_at": row["created_at"],
    }
