"""Late supplements cannot retrospectively steal another submission's earliest image evidence."""

from fastapi.testclient import TestClient

from backend.tests.test_api import act, admin, report, upload
from backend.tests.test_proof import create_submission
from backend.tests.test_visitors import account, snapshot


def test_late_copied_photo_does_not_borrow_old_event_creation_time(client):
    """Compare upload/submission chronology rather than the mutable parent event's age."""
    first, _ = report(client)
    other = TestClient(client.app)
    account(other)
    independent, _ = create_submission(other, "blue")
    manager = admin(client)
    requested = act(client, first["id"], manager, "request_info", note="隔离补充材料测试")
    assert requested.status_code == 200
    supplement = act(
        client,
        first["id"],
        {},
        "supplement",
        description="后补同图，不能抢走先前投稿的独立证据",
        original_images=[upload(client, "blue")],
    )
    assert supplement.status_code == 200, supplement.text
    assert act(client, first["id"], manager, "assign", assignee="隔离清理组").status_code == 200
    assert (
        act(client, independent["id"], manager, "assign", assignee="隔离清理组").status_code == 200
    )
    assert snapshot(client)["summary"]["guardian_value"] == 20
    assert snapshot(other)["summary"]["guardian_value"] == 20
