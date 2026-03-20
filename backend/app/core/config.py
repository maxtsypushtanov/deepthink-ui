"""Application configuration."""

from __future__ import annotations

import json
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite+aiosqlite:///./deepthink.db"
    db_path: str = str(Path(__file__).resolve().parent.parent.parent / "deepthink.db")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]

    # Providers (loaded from DB at runtime, env vars are fallback)
    openrouter_api_key: str = ""
    deepseek_api_key: str = ""
    cloudru_api_key: str = ""
    custom_api_key: str = ""
    custom_base_url: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
