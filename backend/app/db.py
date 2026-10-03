import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from .errors import APIError


def now() -> str:
    return datetime.now(UTC).isoformat()


def encode(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def materials_match(snapshot, event, kind) -> bool:
    # A resolution upload must not invalidate an unchanged report's analysis.
    keys = (
        ("original_images", "description", "point_id")
        if kind == "report"
        else ("original_images", "resolution_images", "resolution_note")
    )
    for key in keys:
        current = event[key]
        if key.endswith("_images") and isinstance(current, str):
            current = json.loads(current)
        if snapshot[key] != current:
            return False
    if kind == "resolution" and "relationship_version" in snapshot:
        if snapshot["relationship_version"] != event["relationship_version"]:
            return False
    return True


SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
 id TEXT PRIMARY KEY, path TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
 sha256 TEXT NOT NULL, token_hash TEXT NOT NULL, event_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_digest ON uploads(sha256);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, scenic_id TEXT NOT NULL, point_id TEXT NOT NULL,
 description TEXT NOT NULL, original_images TEXT NOT NULL, status TEXT NOT NULL,
 assignee TEXT, resolution_images TEXT NOT NULL DEFAULT '[]',
 resolution_note TEXT NOT NULL DEFAULT '',
 review_note TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL, material_version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_status ON events(status);
CREATE TABLE IF NOT EXISTS timeline (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES events(id),
 action TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, from_status TEXT,
 to_status TEXT NOT NULL, created_at TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS analyses (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), version INTEGER NOT NULL,
 kind TEXT NOT NULL, material_version INTEGER NOT NULL, status TEXT NOT NULL, model TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, input_snapshot TEXT NOT NULL,
 result TEXT, error TEXT, UNIQUE(event_id, version)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS postcards (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, scenic_id TEXT NOT NULL,
 description TEXT NOT NULL, images TEXT NOT NULL, created_at TEXT NOT NULL
);
"""

UPGRADE = """
BEGIN IMMEDIATE;
ALTER TABLE uploads ADD COLUMN dhash TEXT;
ALTER TABLE events ADD COLUMN merged_into TEXT REFERENCES events(id);
ALTER TABLE events ADD COLUMN relationship_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX events_parent ON events(merged_into);
CREATE TABLE proof_runs (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 material_version INTEGER NOT NULL, relationship_version INTEGER NOT NULL,
 status TEXT NOT NULL, model TEXT NOT NULL, started_at TEXT NOT NULL,
 finished_at TEXT, steps TEXT NOT NULL, conclusion TEXT, error TEXT,
 candidates TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX proofs_event ON proof_runs(event_id,started_at);
PRAGMA user_version=2;
COMMIT;
"""

VISITOR_UPGRADE = """
BEGIN IMMEDIATE;
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE visitor_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL
);
ALTER TABLE events ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE events ADD COLUMN legacy_access INTEGER NOT NULL DEFAULT 1;
ALTER TABLE postcards ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE postcards ADD COLUMN legacy_access INTEGER NOT NULL DEFAULT 1;
ALTER TABLE uploads ADD COLUMN owner_id TEXT REFERENCES users(id);
ALTER TABLE uploads ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX events_owner ON events(owner_id,created_at);
CREATE INDEX postcards_owner ON postcards(owner_id,created_at);
CREATE TABLE explorations (
 user_id TEXT NOT NULL REFERENCES users(id), scenic_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,scenic_id)
);
CREATE TABLE contribution_reviews (
 event_id TEXT PRIMARY KEY REFERENCES events(id), decision TEXT NOT NULL,
 note TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE rewards (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 reference TEXT NOT NULL, label TEXT NOT NULL, points INTEGER NOT NULL,
 active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(user_id,kind,reference)
);
CREATE TABLE reward_changes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, reward_id TEXT NOT NULL REFERENCES rewards(id),
 delta INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE badges (
 user_id TEXT NOT NULL REFERENCES users(id), badge_id TEXT NOT NULL,
 active INTEGER NOT NULL, earned_at TEXT NOT NULL, PRIMARY KEY(user_id,badge_id)
);
PRAGMA user_version=3;
COMMIT;
"""


class Database:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()
        self.path = self.data_dir / "events.sqlite3"
        self.images = self.data_dir / "images"

    def initialize(self):
        """Initialize or upgrade with a consistent SQLite backup, retaining all old materials."""
        self.images.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2, 3):
                raise RuntimeError("不支持此数据库版本，请使用匹配版本的应用")
            if version in (1, 2):
                backup_dir = self.data_dir / "backups"
                backup_dir.mkdir(exist_ok=True)
                with sqlite3.connect(backup_dir / f"before-v3-{uuid4().hex}.sqlite3") as backup:
                    conn.backup(backup)
            conn.executescript(SCHEMA)
            if version < 2:
                conn.executescript(UPGRADE)
            if version < 3:
                conn.executescript(VISITOR_UPGRADE)
        with self.transaction() as conn:
            interrupted = conn.execute("SELECT * FROM analyses WHERE status='running'").fetchall()
            for run in interrupted:
                self.fail_run(conn, run, "ai_interrupted", "上次分析因服务重启中断，请重试")
            conn.execute(
                "UPDATE proof_runs SET status='failed',finished_at=?,error=? "
                "WHERE status='running'",
                (now(), "上次证据分析因服务重启中断，材料已保存，请重试"),
            )

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self):
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    @staticmethod
    def row(conn, event_id):
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if row is None:
            raise APIError(404, "not_found", "事件不存在")
        return row

    @staticmethod
    def timeline(conn, event_id, action, actor, note, from_status, to_status, evidence=None):
        conn.execute(
            "INSERT INTO timeline(event_id,action,actor,note,from_status,to_status,"
            "created_at,evidence) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (event_id, action, actor, note, from_status, to_status, now(), encode(evidence or {})),
        )

    def fail_run(self, conn, run, code, message):
        error = {"code": code, "message": message, "retryable": True, "details": []}
        conn.execute(
            "UPDATE analyses SET status='failed',error=?,finished_at=? WHERE id=?",
            (encode(error), now(), run["id"]),
        )
        event = self.row(conn, run["event_id"])
        self.timeline(
            conn,
            event["id"],
            "analysis_failed",
            "system",
            message,
            event["status"],
            event["status"],
            {"analysis_id": run["id"]},
        )

    def event(self, conn, event_id, *, admin=False):
        """Return scoped submission materials and a sanitized shared governance summary."""
        event = dict(self.row(conn, event_id))
        event.pop("token_hash")
        event.pop("owner_id", None)
        event.pop("legacy_access", None)
        review = conn.execute(
            "SELECT * FROM contribution_reviews WHERE event_id=?", (event_id,)
        ).fetchone()
        event["contribution_review"] = dict(review) if review else None
        event["is_demo"] = bool(event["is_demo"])
        for key in ("original_images", "resolution_images"):
            event[key] = json.loads(event[key])
        event["timeline"] = []
        for row in conn.execute("SELECT * FROM timeline WHERE event_id=? ORDER BY id", (event_id,)):
            item = dict(row)
            item.pop("event_id")
            item["evidence"] = json.loads(item["evidence"])
            event["timeline"].append(item)
        event["analyses"] = []
        event["ai_status"] = {"report": "not_started", "resolution": "not_started"}
        for row in conn.execute(
            "SELECT * FROM analyses WHERE event_id=? ORDER BY version", (event_id,)
        ):
            item = dict(row)
            item.pop("event_id")
            for key in ("input_snapshot", "result", "error"):
                item[key] = json.loads(item[key]) if item[key] else None
            item["stale"] = not materials_match(item["input_snapshot"], event, item["kind"])
            if not admin and item["kind"] == "resolution":
                own_ids = {i["id"] for i in event["original_images"]}
                snapshot = item["input_snapshot"]
                snapshot["original_images"] = [
                    i for i in snapshot["original_images"] if i["id"] in own_ids
                ]
                snapshot.pop("group_images", None)
                if item["result"] and "reviewed_images" in item["result"]:
                    item["result"]["reviewed_images"] = [
                        i for i in item["result"]["reviewed_images"] if i["id"] in own_ids
                    ]
            event["analyses"].append(item)
            if not item["stale"]:
                event["ai_status"][item["kind"]] = item["status"]
        proof = conn.execute(
            "SELECT * FROM proof_runs WHERE event_id=? ORDER BY started_at DESC LIMIT 1",
            (event_id,),
        ).fetchone()
        event["proof"] = None
        if proof:
            item = dict(proof)
            item.pop("event_id")
            item.pop("candidates")
            item["steps"] = json.loads(item["steps"])
            item["conclusion"] = json.loads(item["conclusion"]) if item["conclusion"] else None
            item["stale"] = (
                item["material_version"] != event["material_version"]
                or item.pop("relationship_version") != event["relationship_version"]
            )
            event["proof"] = item
        from .cases import governance_summary

        event["governance"] = governance_summary(conn, event)
        return event
