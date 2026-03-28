"""Application configuration."""

from __future__ import annotations

from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "sqlite+aiosqlite:///./deepthink.db"
    db_path: str = ""

    # Server
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    # Providers (loaded from DB at runtime, env vars are fallback)
    openrouter_api_key: str = ""
    deepseek_api_key: str = ""
    cloudru_api_key: str = ""
    custom_api_key: str = ""
    custom_base_url: str = ""

    # GitHub MCP
    github_personal_access_token: str = ""


    @model_validator(mode="after")
    def derive_db_path(self) -> "Settings":
        """Derive db_path from database_url if not explicitly set."""
        if not self.db_path:
            url = self.database_url
            # Extract file path from sqlite URL like "sqlite+aiosqlite:///./deepthink.db"
            if ":///" in url:
                raw = url.split(":///", 1)[1]
                self.db_path = str(Path(raw).resolve())
            else:
                self.db_path = str(
                    Path(__file__).resolve().parent.parent.parent / "deepthink.db"
                )
        return self


settings = Settings()
