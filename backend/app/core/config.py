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

    # Email delivery — two transports supported, picked in this order:
    #   1) RESEND_API_KEY set → HTTP API to api.resend.com (recommended on
    #      Railway; PaaS providers usually block outbound SMTP entirely).
    #   2) SMTP_HOST set       → classic SMTP via smtplib (Gmail App Password,
    #      Office 365, etc.). Works on self-hosted / VPS where 587/465 egress
    #      isn't filtered.
    # Leave both blank to disable email — alerts then log as failed.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = ""  # used by both transports; e.g. "ISB Notifications <noreply@yourschool.com>"
    EMAIL_FROM_FALLBACK_NAME: str = "ISB Notifications"

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "ISB Notifications"

    # Cooldown between repeated low-balance alerts for the same parent/child
    # pair — prevents spam when a student's balance lingers near the threshold.
    LOW_BALANCE_ALERT_COOLDOWN_HOURS: int = 4

    # Kill-switch for the Daily Spending Limit by Spending Group feature.
    # Set to False in Railway env to disable limit enforcement globally without
    # a code deploy (useful during first schema-only rollout phase).
    SPENDING_LIMIT_ENABLED: bool = True

    class Config:
        env_file = ".env"
        case_sensitive = True


# Global settings instance
settings = Settings()
