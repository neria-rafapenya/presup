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
    supabase_anon_key: str = Field(default="", validation_alias="SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(default="", validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="", validation_alias="GEMINI_MODEL")
    gemini_embedding_model: str = Field(default="", validation_alias="GEMINI_EMBEDDING_MODEL")

    @model_validator(mode="after")
    def validate_runtime_contract(self) -> "Settings":
        supabase_values = (
            self.supabase_url,
            self.supabase_anon_key,
            self.supabase_service_role_key,
        )
        if any(supabase_values) and not all(supabase_values):
            raise ValueError("SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY deben ir juntos")
        if not self.ai_mock and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY es obligatorio cuando AI_MOCK=false")
        if not self.ai_mock and (not self.gemini_model or not self.gemini_embedding_model):
            raise ValueError("GEMINI_MODEL y GEMINI_EMBEDDING_MODEL son obligatorios con IA real")
        return self

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key and self.supabase_service_role_key)

    def public_summary(self) -> dict[str, bool]:
        """Return non-sensitive state suitable for diagnostics and tests."""

        return {"ai_mock": self.ai_mock, "supabase_configured": self.supabase_configured}


@lru_cache
def get_settings() -> Settings:
    return Settings()
