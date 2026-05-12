"""
Upload Service — Cloudinary integration for student profile photos.

Requires env var CLOUDINARY_URL in the form:
    cloudinary://<api_key>:<api_secret>@<cloud_name>

If CLOUDINARY_URL is unset, upload calls raise RuntimeError so the caller can
return a clear error to the admin.
"""
from __future__ import annotations

import logging
from typing import BinaryIO

from app.core.config import settings

logger = logging.getLogger(__name__)


def _ensure_configured() -> None:
    if not settings.CLOUDINARY_URL:
        raise RuntimeError(
            "CLOUDINARY_URL is not configured. Set env var to enable profile photo upload."
        )
    import cloudinary  # lazy import so backend boots without the package if unused
    cloudinary.config(cloudinary_url=settings.CLOUDINARY_URL, secure=True)


def upload_student_photo(file: BinaryIO, customer_code: str) -> str:
    """Upload a student profile photo to Cloudinary and return the secure URL.

    Uses customer_code as public_id so re-uploading replaces the previous photo.
    Transformation crops to 400x400 fill for consistent avatar sizing.
    """
    _ensure_configured()
    import cloudinary.uploader  # lazy

    result = cloudinary.uploader.upload(
        file,
        folder="isb-students",
        public_id=str(customer_code),
        overwrite=True,
        resource_type="image",
        transformation=[{"width": 400, "height": 400, "crop": "fill", "gravity": "face"}],
    )
    url = result.get("secure_url")
    if not url:
        raise RuntimeError("Cloudinary upload did not return a secure URL")
    logger.info("Uploaded student photo for %s → %s", customer_code, url)
    return url


def upload_product_photo(file: BinaryIO, shop_id: str, product_id: int) -> str:
    """Upload a product/menu photo to Cloudinary and return the secure URL.

    Uses `{shop_id}-{product_id}` as public_id so re-uploading replaces the
    previous image. Crops to 600x600 fill for catalogue/thumbnail display.
    """
    _ensure_configured()
    import cloudinary.uploader  # lazy

    result = cloudinary.uploader.upload(
        file,
        folder=f"isb-products/{shop_id}",
        public_id=f"{shop_id}-{product_id}",
        overwrite=True,
        resource_type="image",
        transformation=[{"width": 600, "height": 600, "crop": "fill", "gravity": "auto"}],
    )
    url = result.get("secure_url")
    if not url:
        raise RuntimeError("Cloudinary upload did not return a secure URL")
    logger.info("Uploaded product photo %s/%s → %s", shop_id, product_id, url)
    return url
