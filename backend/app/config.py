import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./dev.db"  # fallback для локального теста без Postgres
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    UPLOAD_DIR: str = "uploads"
    # Готовая локальная учётная запись администратора создаётся автоматически
    # при первом запуске, если её ещё нет в базе. При необходимости значения
    # можно переопределить через .env.
    BOOTSTRAP_ADMIN_EMAIL: str = "admin@homelyceum.local"
    BOOTSTRAP_ADMIN_PASSWORD: str = "admin12345"
    BOOTSTRAP_ADMIN_NAME: str = "Главный администратор"


settings = Settings()

# Use one stable absolute path regardless of the process working directory.
# Render persistent disks can be mounted by setting UPLOAD_DIR=/var/data/uploads.
_upload_dir = Path(settings.UPLOAD_DIR).expanduser()
if not _upload_dir.is_absolute():
    _upload_dir = Path(__file__).resolve().parents[1] / _upload_dir
settings.UPLOAD_DIR = str(_upload_dir.resolve())

# Убеждаемся, что папка для файлов существует
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
