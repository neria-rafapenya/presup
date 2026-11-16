"""Runtime configuration with safe local defaults."""

from functools import lru_cache
from pathlib import Path

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

    ai_mock: bool = Field(default=False, validation_alias="AI_MOCK")
    supabase_url: str = Field(default="", validation_alias="SUPABASE_URL")
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    gemini_api_key: str = Field(default="", validation_alias="GEMINI_API_KEY")
    gemini_model: str = Field(default="", validation_alias="GEMINI_MODEL")
    gemini_embedding_model: str = Field(default="", validation_alias="GEMINI_EMBEDDING_MODEL")
    resend_api_key: str = Field(default="", validation_alias="RESEND_API_KEY")
    resend_from_email: str = Field(default="", validation_alias="RESEND_FROM_EMAIL")
    resend_from_name: str = Field(default="Horekia", validation_alias="RESEND_FROM_NAME")
    product_upload_dir: str = Field(
        default=str(Path(__file__).resolve().parents[1] / "uploads" / "products"),
        validation_alias="PRODUCT_UPLOAD_DIR",
    )
    media_public_base_url: str = Field(default="http://localhost:8000/media", validation_alias="MEDIA_PUBLIC_BASE_URL")
    cors_origins_raw: str = Field(
        default="http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082,http://localhost:5173,http://127.0.0.1:5173,https://app.horekia.com,https://horekia.com,https://www.horekia.com",
        validation_alias="CORS_ORIGINS",
    )
    backoffice_master_email: str = Field(default="", validation_alias="BACKOFFICE_MASTER_EMAIL")
    backoffice_master_password: str = Field(default="", validation_alias="BACKOFFICE_MASTER_PASSWORD")

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

    @property
    def email_configured(self) -> bool:
        return bool(self.resend_api_key and self.resend_from_email)

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins_raw.split(",") if origin.strip()]

    def public_summary(self) -> dict[str, bool]:
        """Return non-sensitive state suitable for diagnostics and tests."""

        return {"ai_mock": self.ai_mock, "database_configured": self.database_configured, "email_configured": self.email_configured}


@lru_cache
def get_settings() -> Settings:
    return Settings()
