import os
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

# Убеждаемся, что папка для файлов существует
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
