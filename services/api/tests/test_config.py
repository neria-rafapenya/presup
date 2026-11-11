from app.config import Settings


def test_mock_mode_allows_empty_external_credentials() -> None:
    settings = Settings(
        AI_MOCK="true",
        SUPABASE_URL="",
        SUPABASE_ANON_KEY="",
        SUPABASE_SERVICE_ROLE_KEY="",
        GEMINI_API_KEY="",
    )
    assert settings.ai_mock is True
    assert settings.supabase_configured is False


def test_partial_supabase_configuration_is_rejected() -> None:
    try:
        Settings(AI_MOCK="true", SUPABASE_URL="https://example.supabase.co")
    except ValueError as exc:
        assert "SUPABASE_URL" in str(exc)
    else:
        raise AssertionError("partial Supabase configuration should fail")
