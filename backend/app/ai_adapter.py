"""C owns this boundary. D implements backend.app.ai.provider, without database access."""

import importlib
from dataclasses import dataclass, field
from pathlib import Path

from .errors import APIError
from .models import ReportResult, ResolutionResult


@dataclass(frozen=True)
class AIConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)
    timeout_seconds: float
    log_path: str = "data/ai_calls.jsonl"


class ModuleAI:
    @staticmethod
    def provider():
        try:
            return importlib.import_module("backend.app.ai.provider")
        except ImportError as exc:
            raise APIError(
                503,
                "ai_unavailable",
                "AI 模块暂不可用，材料已保存，可重试或人工处理",
                retryable=True,
            ) from exc

    async def analyze_report(
        self, *, photos: list[Path], point: dict, description: str, config: AIConfig
    ) -> ReportResult:
        return await self.provider().analyze_report(
            photos=photos, point=point, description=description, config=config
        )

    async def review_resolution(
        self,
        *,
        original_photos: list[Path],
        resolution_photos: list[Path],
        resolution_note: str,
        config: AIConfig,
    ) -> ResolutionResult:
        return await self.provider().review_resolution(
            original_photos=original_photos,
            resolution_photos=resolution_photos,
            resolution_note=resolution_note,
            config=config,
        )

    async def compare_reports(
        self, *, source_photos, target_photos, source_description, target_description, config
    ):
        """Delegate semantic candidate comparison without mutating governance state."""
        return await self.provider().compare_reports(
            source_photos=source_photos,
            target_photos=target_photos,
            source_description=source_description,
            target_description=target_description,
            config=config,
        )
