"""
Tool Gateway — Application Settings (loaded from .env)

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
    TOOL_GATEWAY_PORT: int = 8080

    # ── Service auth ──────────────────────────────────────────
    GATEWAY_SERVICE_KEY: str = ""
    EXECUTION_GRANT_SECRET: str = ""

    # ── Salesforce credentials ────────────────────────────────
    SF_USERNAME: Optional[str] = None
    SF_PASSWORD: Optional[str] = None
    SF_SECURITY_TOKEN: Optional[str] = None
    SF_DOMAIN: str = "login"
    SF_LOGIN_URL: str = "https://login.salesforce.com"
    SF_CONSUMER_KEY: Optional[str] = None
    SF_PRIVATE_KEY_PATH: Optional[str] = None
    SF_ORG_TYPE: str = ""
    SF_MOCK_MODE: bool = False

    # ── MCP client tuning ─────────────────────────────────────
    MCP_REQUEST_TIMEOUT_SEC: int = 30
    MCP_MAX_RETRIES: int = 2

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def validate_no_defaults(self) -> None:
        """Refuse to start outside development if secrets still have default values."""
        if self.CDM_ENV == "development":
            return

        _DEFAULTS = {
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

    @property
    def sf_mock_enabled(self) -> bool:
        return self.SF_MOCK_MODE

    @property
    def is_production(self) -> bool:
        return self.CDM_ENV.lower() == "production"


# Singleton instance — import this everywhere
settings = Settings()
