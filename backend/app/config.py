import logging
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    environment: str = "development"
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash"
    firebase_service_account_path: str = "serviceAccountKey.json"
    firebase_project_id: str = "er-cardiac-hackathon"
    allowed_origins: list[str] = ["http://localhost:5173"]
    log_level: str = "INFO"
    rate_limit_per_minute: int = 100

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        level=getattr(logging, level.upper(), logging.INFO),
    )
