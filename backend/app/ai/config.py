"""环境变量配置。密钥只从服务端环境变量读取。"""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AIConfig:
    api_key: str
    base_url: str
    model: str
    timeout_s: float
    max_retries: int
    log_path: str
    max_image_bytes: int = 8 * 1024 * 1024


def load_config() -> AIConfig:
    """每次调用时读取，便于测试覆盖。"""
    return AIConfig(
        api_key=os.environ.get("AI_API_KEY", ""),
        base_url=os.environ.get(
            "AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ).rstrip("/"),
        model=os.environ.get("AI_MODEL", "qwen3-vl-plus"),
        timeout_s=float(os.environ.get("AI_TIMEOUT_S", "60")),
        max_retries=int(os.environ.get("AI_MAX_RETRIES", "1")),
        log_path=os.environ.get("AI_CALL_LOG", "data/ai_calls.jsonl"),
    )
