from app.config import Settings


def test_mock_mode_allows_empty_external_credentials() -> None:
    settings = Settings(
        AI_MOCK="true",
        DATABASE_URL="",
        GEMINI_API_KEY="",
    )
    assert settings.ai_mock is True
    assert settings.database_configured is False


def test_database_connection_is_optional_in_mock_mode() -> None:
    settings = Settings(AI_MOCK="true", DATABASE_URL="postgresql://example")
    assert settings.database_configured is True
