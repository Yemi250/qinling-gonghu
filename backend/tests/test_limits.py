from io import BytesIO

from PIL import Image


def test_chunked_body_limit_includes_unused_multipart_fields(client):
    image = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, "PNG")
    client.app.state.settings.max_upload_bytes = 1024
    body = (
        b'--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="ok.png"\r\n'
        b"Content-Type: image/png\r\n\r\n"
        + image.getvalue()
        + b'\r\n--test-boundary\r\nContent-Disposition: form-data; '
        b'name="unused"; filename="large"\r\n'
        b"Content-Type: application/octet-stream\r\n\r\n"
        + b"x" * (2 * 1024 * 1024)
        + b"\r\n--test-boundary--\r\n"
    )
    response = client.post(
        "/api/uploads",
        content=iter([body]),
        headers={
            "Content-Type": "multipart/form-data; boundary=test-boundary",
        },
    )
    assert response.status_code == 413
    assert not list(client.app.state.db.images.iterdir())
