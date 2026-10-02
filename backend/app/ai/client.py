"""OpenAI 兼容接口客户端（百炼 DashScope 默认）。含重试、超时、错误分类、调用日志。"""
from __future__ import annotations

import base64
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

import httpx

from .config import AIConfig
from .schemas import ImageInput


class AIError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _sniff_mime(raw: bytes) -> str:
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    raise AIError("bad_image", "仅支持 JPEG/PNG/WebP 图片")


def image_to_data_url(img: ImageInput, max_bytes: int) -> str:
    raw = img.data
    if raw is None:
        if not img.path:
            raise AIError("bad_image", "未提供图片")
        try:
            raw = Path(img.path).read_bytes()
        except OSError as e:
            raise AIError("bad_image", f"图片读取失败：{e.__class__.__name__}")
    if not raw or len(raw) > max_bytes:
        raise AIError("bad_image", "图片为空或超过大小限制")
    mime = _sniff_mime(raw)
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _log(cfg: AIConfig, record: dict) -> None:
    """只写元数据，不记录图片内容与密钥。"""
    try:
        p = Path(cfg.log_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _extract_json(text: str) -> dict:
    t = text.strip()
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end <= start:
        raise AIError("invalid_output", "模型未返回 JSON")
    try:
        obj = json.loads(t[start : end + 1])
    except json.JSONDecodeError:
        raise AIError("invalid_output", "模型返回的 JSON 无法解析")
    if not isinstance(obj, dict):
        raise AIError("invalid_output", "模型返回的 JSON 不是对象")
    return obj


def chat_json(
    cfg: AIConfig, system: str, user_text: str, images: List[ImageInput], op: str
) -> Tuple[dict, int]:
    """返回 (解析后的 dict, 耗时毫秒)。失败抛 AIError。"""
    if not cfg.api_key:
        raise AIError("auth", "未配置 AI_API_KEY")
    content = [{"type": "text", "text": user_text}]
    for img in images:
        content.append(
            {"type": "image_url", "image_url": {"url": image_to_data_url(img, cfg.max_image_bytes)}}
        )
    body = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    url = f"{cfg.base_url}/chat/completions"

    last = AIError("network", "未知错误")
    t0 = time.monotonic()
    for attempt in range(cfg.max_retries + 1):
        try:
            r = httpx.post(url, json=body, headers=headers, timeout=cfg.timeout_s)
            if r.status_code in (401, 403):
                raise AIError("auth", "模型密钥无效或无权限")
            if r.status_code == 429:
                raise AIError("rate_limit", "模型调用被限流")
            if r.status_code >= 400:
                raise AIError("network", f"模型服务返回 {r.status_code}")
            msg = r.json()["choices"][0]["message"]["content"]
            data = _extract_json(msg if isinstance(msg, str) else json.dumps(msg))
            ms = int((time.monotonic() - t0) * 1000)
            _log(cfg, {"ts": datetime.now(timezone.utc).isoformat(), "op": op,
                       "model": cfg.model, "ok": True, "latency_ms": ms,
                       "attempt": attempt + 1, "images": len(images)})
            return data, ms
        except httpx.TimeoutException:
            last = AIError("timeout", "模型调用超时")
        except httpx.HTTPError:
            last = AIError("network", "无法连接模型服务")
        except (KeyError, IndexError, ValueError, TypeError):
            last = AIError("invalid_output", "模型响应结构异常")
        except AIError as e:
            last = e
            if e.code in ("auth", "bad_image"):
                break
    ms = int((time.monotonic() - t0) * 1000)
    _log(cfg, {"ts": datetime.now(timezone.utc).isoformat(), "op": op, "model": cfg.model,
               "ok": False, "latency_ms": ms, "error": last.code, "images": len(images)})
    raise last
