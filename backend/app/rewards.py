"""Server-derived participation rewards, reversible adjustments and six honest badges."""

import json
from uuid import uuid4

from .db import now

SCENICS = {
    "terracotta-demo": "兵马俑",
    "qinling-demo": "太白山",
    "huashan-demo": "华山",
    "baotashan-demo": "宝塔山",
    "hanzhong-demo": "汉中油菜花海",
    "zhenbeitai-demo": "镇北台",
}
BADGES = [
    ("departure", "山河启程", "探索首个景区", "explored_count", 1),
    ("collector", "风景收藏家", "保存首张明信片", "memory_count", 1),
    ("wanderer", "三秦漫游者", "探索三个不同景区", "explored_count", 3),
    ("guardian", "山河共护者", "获得一次有效共护贡献", "valid_contribution_count", 1),
    ("echo", "善意有回音", "有效贡献关联的事件人工结案", "closed_case_count", 1),
    ("six-scenes", "六景巡游", "探索全部六个景区", "explored_count", 6),
]


def evidence_digests(conn, raw):
    """Read normalized JPEG byte hashes; image distance is never a truth probability."""
    ids = [image["id"] for image in json.loads(raw)]
    return {
        row[0]
        for image_id in ids
        for row in conn.execute("SELECT sha256 FROM uploads WHERE id=?", (image_id,))
    }


def contribution_facts(conn):
    """Recognize earliest original evidence, explicit review and current root state."""
    events = [dict(row) for row in conn.execute("SELECT * FROM events ORDER BY created_at,id")]
    by_id = {row["id"]: row for row in events}
    first_evidence, independent, hashes_by_event = {}, {}, {}
    for event in events:
        hashes_by_event[event["id"]] = set()
        for image in json.loads(event["original_images"]):
            upload = conn.execute(
                "SELECT sha256,created_at FROM uploads WHERE id=?", (image["id"],)
            ).fetchone()
            if not upload:
                continue
            digest = upload["sha256"]
            hashes_by_event[event["id"]].add(digest)
            # A photo added later cannot borrow the older event's creation time.
            order = (max(event["created_at"], upload["created_at"]), event["id"])
            if digest not in first_evidence or order < first_evidence[digest]:
                first_evidence[digest] = order
    for event in events:
        independent[event["id"]] = any(
            first_evidence[h][1] == event["id"] for h in hashes_by_event[event["id"]]
        )
    reviews = {
        r["event_id"]: r["decision"]
        for r in conn.execute("SELECT event_id,decision FROM contribution_reviews")
    }
    facts = []
    for event in events:
        root = by_id[event["merged_into"] or event["id"]]
        decision = reviews.get(event["id"])
        if decision is None and not event["merged_into"]:
            decision = (
                "accepted"
                if conn.execute(
                    "SELECT 1 FROM timeline WHERE event_id=? AND action='assign'", (event["id"],)
                ).fetchone()
                else "pending"
            )
        valid = bool(
            event["owner_id"]
            and independent[event["id"]]
            and decision == "accepted"
            and root["status"] in {"processing", "pending_acceptance", "closed"}
        )
        facts.append(
            {
                **event,
                "root_id": root["id"],
                "root_status": root["status"],
                "independent": independent[event["id"]],
                "valid": valid,
                "decision": decision or "pending",
            }
        )
    return facts


def desired_rewards(conn, user_id, facts):
    """Derive bounded exploration/memory rewards and one contribution per current case."""
    desired = {}
    explored = conn.execute("SELECT scenic_id FROM explorations WHERE user_id=?", (user_id,))
    for row in explored:
        desired[("explore", row[0])] = (5, f"探索印记 · {SCENICS[row[0]]}")
    used_hashes, memory_scenes = set(), set()
    for card in conn.execute(
        "SELECT * FROM postcards WHERE owner_id=? ORDER BY created_at,id", (user_id,)
    ):
        hashes = evidence_digests(conn, card["images"])
        if hashes - used_hashes and card["scenic_id"] not in memory_scenes:
            memory_scenes.add(card["scenic_id"])
            desired[("memory", card["scenic_id"])] = (
                10,
                f"风景记忆 · {SCENICS[card['scenic_id']]}",
            )
        used_hashes.update(hashes)
    for fact in facts:
        if fact["owner_id"] == user_id and fact["valid"]:
            desired[("contribution", fact["root_id"])] = (
                20,
                f"有效共护 · {SCENICS.get(fact['scenic_id'], fact['scenic_id'])}",
            )
    return desired


def summary_counts(conn, user_id, facts):
    """Count owned records and distinct valid cases, not unverified people or physical visits."""
    own = [f for f in facts if f["owner_id"] == user_id]
    valid = {f["root_id"] for f in own if f["valid"]}
    closed = {f["root_id"] for f in own if f["valid"] and f["root_status"] == "closed"}
    return {
        "explored_count": conn.execute(
            "SELECT COUNT(*) FROM explorations WHERE user_id=?", (user_id,)
        ).fetchone()[0],
        "memory_count": conn.execute(
            "SELECT COUNT(*) FROM postcards WHERE owner_id=?", (user_id,)
        ).fetchone()[0],
        "valid_contribution_count": len(valid),
        "closed_case_count": len(closed),
        "guardian_value": conn.execute(
            "SELECT COALESCE(SUM(points),0) FROM rewards WHERE user_id=? AND active=1", (user_id,)
        ).fetchone()[0],
    }


def reconcile_all(conn):
    """Update rewards in the caller's transaction; keep adjustments instead of deleting history."""
    facts, timestamp = contribution_facts(conn), now()
    for user in conn.execute("SELECT id FROM users").fetchall():
        user_id = user[0]
        desired = desired_rewards(conn, user_id, facts)
        existing = {
            (r["kind"], r["reference"]): dict(r)
            for r in conn.execute("SELECT * FROM rewards WHERE user_id=?", (user_id,))
        }
        for key in existing.keys() | desired.keys():
            active, previous = key in desired, existing.get(key)
            if previous and bool(previous["active"]) == active:
                continue
            points, label = (
                desired.get(key, (previous["points"], previous["label"]))
                if (previous)
                else desired[key]
            )
            reward_id = previous["id"] if previous else uuid4().hex
            if previous:
                conn.execute(
                    "UPDATE rewards SET active=?,updated_at=? WHERE id=?",
                    (int(active), timestamp, reward_id),
                )
            else:
                conn.execute(
                    "INSERT INTO rewards VALUES(?,?,?,?,?,?,?,?,?)",
                    (reward_id, user_id, *key, label, points, 1, timestamp, timestamp),
                )
            conn.execute(
                "INSERT INTO reward_changes(reward_id,delta,note,created_at) VALUES(?,?,?,?)",
                (
                    reward_id,
                    points if active else -points,
                    "达成参与条件" if active else "贡献或关联变化，重新核对后调整",
                    timestamp,
                ),
            )
        counts = summary_counts(conn, user_id, facts)
        for badge_id, _name, _condition, metric, target in BADGES:
            active = counts[metric] >= target
            if active:
                conn.execute(
                    "INSERT INTO badges VALUES(?,?,1,?) ON CONFLICT(user_id,badge_id) "
                    "DO UPDATE SET active=1",
                    (user_id, badge_id, timestamp),
                )
            else:
                conn.execute(
                    "UPDATE badges SET active=0 WHERE user_id=? AND badge_id=?", (user_id, badge_id)
                )


def passport(conn, user_id):
    """Return actual personal progress and current badge eligibility without mutating reads."""
    facts = contribution_facts(conn)
    summary = summary_counts(conn, user_id, facts)
    stored = {
        r["badge_id"]: dict(r)
        for r in conn.execute("SELECT * FROM badges WHERE user_id=?", (user_id,))
    }
    badges = [
        {
            "id": badge_id,
            "name": name,
            "condition": condition,
            "target": target,
            "progress": min(summary[metric], target),
            "earned": bool(stored.get(badge_id, {}).get("active")),
            "earned_at": stored.get(badge_id, {}).get("earned_at")
            if (stored.get(badge_id, {}).get("active"))
            else None,
        }
        for badge_id, name, condition, metric, target in BADGES
    ]
    scenes = []
    for scenic_id, name in SCENICS.items():
        explored = bool(
            conn.execute(
                "SELECT 1 FROM explorations WHERE user_id=? AND scenic_id=?", (user_id, scenic_id)
            ).fetchone()
        )
        memories = conn.execute(
            "SELECT COUNT(*) FROM postcards WHERE owner_id=? AND scenic_id=?", (user_id, scenic_id)
        ).fetchone()[0]
        own = [f for f in facts if f["owner_id"] == user_id and f["scenic_id"] == scenic_id]
        valid = any(f["valid"] for f in own)
        scenes.append(
            {
                "scenic_id": scenic_id,
                "name": name,
                "explored": explored,
                "tasks": [
                    {
                        "key": "explore",
                        "label": "翻开这一程",
                        "state": "completed" if explored else "idle",
                    },
                    {
                        "key": "memory",
                        "label": "留住一刻风景",
                        "state": "completed" if memories else "idle",
                    },
                    {
                        "key": "care",
                        "label": "为风景留份关注 · 可选",
                        "state": "completed" if valid else "running" if own else "idle",
                    },
                ],
            }
        )
    return {"summary": summary, "badges": badges, "scenes": scenes}
