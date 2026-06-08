"""
Application Configuration
"""
from typing import List
from pydantic_settings import BaseSettings
from pydantic import validator


class Settings(BaseSettings):
    """Application settings"""

    # Application
    APP_NAME: str = "Bookstore POS System"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    ENVIRONMENT: str = "development"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database — Railway provides DATABASE_URL automatically when PostgreSQL is linked
    DATABASE_URL: str = "postgresql://localhost:5432/isb_coop_pos"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # Security
    SECRET_KEY: str = "change-me-in-production-32chars!!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS — set as comma-separated string: "https://app.vercel.app,http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://localhost:8080,https://isb-beta.vercel.app,https://isb-production.vercel.app,https://isb-kiosk.vercel.app"

    # File Upload
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 5242880  # 5MB

    # Cloudinary (profile photos) — set CLOUDINARY_URL=cloudinary://key:secret@cloud
    CLOUDINARY_URL: str = ""

    # BAY / PYMT Gateway
    PYMT_BASE_URL: str = ""
    PYMT_MERCHANT_TOKEN: str = ""
    PYMT_MERCHANT_CODE: str = ""
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100

    # Offline Sync
    SYNC_INTERVAL_SECONDS: int = 300
    MAX_OFFLINE_TRANSACTIONS: int = 1000

    # Reports
    REPORTS_DIR: str = "./reports"
    REPORTS_RETENTION_DAYS: int = 90

    class Config:
        env_file = ".env"
        case_sensitive = True


# Global settings instance
settings = Settings()
