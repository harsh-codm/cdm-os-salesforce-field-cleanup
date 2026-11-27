"""
CDM-OS — Application Settings (loaded from .env)

Uses pydantic-settings to parse environment variables with defaults
suitable for local Docker Compose development.
"""

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Central configuration loaded from environment variables / .env file."""

    # ── System ────────────────────────────────────────────────
    CDM_ENV: str = "development"
    CDM_LOG_LEVEL: str = "INFO"
    CDM_PORT: int = 8000

    # ── Database ──────────────────────────────────────────────
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "cdm_os_db"
    POSTGRES_USER: str = "cdm_admin"
    POSTGRES_PASSWORD: str = "cdm_secure_password"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def async_database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── Redis ─────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Identity & Auth ───────────────────────────────────────
    CDM_JWT_SECRET: str = "super-secret-jwt-key-change-in-production"
    CDM_AUTH_ENABLED: bool = False  # Disabled for local dev by default

    # ── CORS ─────────────────────────────────────────────────
    CDM_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

    # ── Model Gateway ─────────────────────────────────────────
    MODEL_DEFAULT_PROVIDER: str = "gemini"
    MODEL_FALLBACK_PROVIDER: str = "anthropic"
    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    GEMINI_FREE_TIER: bool = True

    # ── Policy Engine ─────────────────────────────────────────
    POLICY_MODE: str = "enforce"  # enforce | audit_only | dry_run
    POLICY_DEFINITIONS_PATH: str = "policy/definitions"

    # ── MCP Tool Gateway ──────────────────────────────────────
    MCP_GATEWAY_PORT: int = 8080
    MCP_GATEWAY_URL: str = "http://127.0.0.1:8080"
    GATEWAY_SERVICE_KEY: str = ""  # Shared secret for control-plane → tool-gateway auth
    # Shared with the Tool Gateway. Signs one-time execution grants for mutating
    # tools (delete / deprecate / rollback). Empty = grants disabled (dev only).
    EXECUTION_GRANT_SECRET: str = ""
    EXECUTION_GRANT_TTL_SEC: int = 120
    MCP_REQUEST_TIMEOUT_SEC: int = 30
    FIELD_ASSESSMENT_TIMEOUT_SEC: int = 180

    # ── Audit ─────────────────────────────────────────────────
    AUDIT_HMAC_SECRET: str = "hmac-signing-key-for-audit-trail"
    AUDIT_LOG_DIR: str = "audit/logs"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


    def validate_no_defaults(self) -> None:
        """Refuse to start outside development if secrets still have default values."""
        if self.CDM_ENV == "development":
            return

        _DEFAULTS = {
            "CDM_JWT_SECRET": "super-secret-jwt-key-change-in-production",
            "AUDIT_HMAC_SECRET": "hmac-signing-key-for-audit-trail",
            "POSTGRES_PASSWORD": "cdm_secure_password",
            "GATEWAY_SERVICE_KEY": "",
            "EXECUTION_GRANT_SECRET": "",
        }
        violations = [
            name for name, default_val in _DEFAULTS.items()
            if getattr(self, name, None) == default_val
        ]
        if violations:
            raise RuntimeError(
                f"Refusing to start in {self.CDM_ENV}: the following secrets "
                f"still have their default/empty values: {', '.join(violations)}. "
                f"Set real values in the environment or .env file."
            )


# Singleton instance — import this everywhere
settings = Settings()
