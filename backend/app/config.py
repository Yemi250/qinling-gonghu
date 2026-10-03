from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = ROOT / "data"
    frontend_dist: Path = ROOT / "frontend" / "dist"
    demo_admin_username: str = "admin"
    demo_admin_password: str = Field(default="", repr=False)
    demo_admin_min_password_length: int = Field(default=12, ge=8, le=128)
    admin_session_hours: int = Field(default=8, ge=1, le=24)
    ai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ai_model: str = "qwen3-vl-plus"
    ai_api_key: str = Field(default="", repr=False)
    ai_timeout_seconds: float = Field(default=60, gt=0, le=180)
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
