import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

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
PRAGMA user_version=1;
"""


class Database:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir.resolve()
        self.path = self.data_dir / "events.sqlite3"
        self.images = self.data_dir / "images"

    def initialize(self):
        self.images.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError("不支持此数据库版本，请使用匹配版本的应用")
            conn.executescript(SCHEMA)
        with self.transaction() as conn:
            interrupted = conn.execute("SELECT * FROM analyses WHERE status='running'").fetchall()
            for run in interrupted:
                self.fail_run(conn, run, "ai_interrupted", "上次分析因服务重启中断，请重试")

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

    def event(self, conn, event_id):
        event = dict(self.row(conn, event_id))
        event.pop("token_hash")
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
            event["analyses"].append(item)
            if not item["stale"]:
                event["ai_status"][item["kind"]] = item["status"]
        return event
