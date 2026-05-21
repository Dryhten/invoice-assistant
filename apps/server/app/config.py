from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = Field(default=3001, alias="PORT")
    web_port: int = Field(default=5173, alias="WEB_PORT")
    pdf_text_request_timeout_ms: int = Field(default=300000, alias="PDF_TEXT_REQUEST_TIMEOUT_MS")
    max_upload_mb: int = Field(default=50, alias="MAX_UPLOAD_MB")

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024



@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
