"""Runtime configuration with safe local defaults."""

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration read from the repository .env or the process environment."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ai_mock: bool = Field(default=True, validation_alias="AI_MOCK")
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="", validation_alias="GEMINI_MODEL")
    gemini_embedding_model: str = Field(default="", validation_alias="GEMINI_EMBEDDING_MODEL")

    @model_validator(mode="after")
    def validate_runtime_contract(self) -> "Settings":
        if not self.ai_mock and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY es obligatorio cuando AI_MOCK=false")
        if not self.ai_mock and (not self.gemini_model or not self.gemini_embedding_model):
            raise ValueError("GEMINI_MODEL y GEMINI_EMBEDDING_MODEL son obligatorios con IA real")
        return self

    @property
    def database_configured(self) -> bool:
        return bool(self.database_url)

    def public_summary(self) -> dict[str, bool]:
        """Return non-sensitive state suitable for diagnostics and tests."""

        return {"ai_mock": self.ai_mock, "database_configured": self.database_configured}


@lru_cache
def get_settings() -> Settings:
    return Settings()
