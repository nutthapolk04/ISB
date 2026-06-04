"""
Customer Display API — standby-image management for the second-monitor screen.

Public endpoints (no auth — the display window itself runs without a login):
    GET  /api/v1/customer-display/images
    GET  /api/v1/customer-display/images/{id}/binary

Admin endpoints (admin role only):
    POST   /api/v1/admin/customer-display/images        (multipart upload)
    DELETE /api/v1/admin/customer-display/images/{id}
    PATCH  /api/v1/admin/customer-display/images/order  (reorder)
"""
from typing import List

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.customer_display import CustomerDisplayImage
from app.models.user import User
from app.schemas.customer_display import (
    CustomerDisplayImageReorder,
    CustomerDisplayImageResponse,
)

# Caps enforced at the API layer — see spec §1 "Image limit".
MAX_IMAGES = 10
MAX_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_TYPES = {"image/jpeg", "image/png"}

# ── Routers ─────────────────────────────────────────────────────────────────
# Two routers: one mounted at the public prefix, one at the admin prefix.
# Keeps the FastAPI tag/role split clean in /docs.
public_router = APIRouter()
admin_router = APIRouter()


# ── Public endpoints ────────────────────────────────────────────────────────

@public_router.get("/images", response_model=List[CustomerDisplayImageResponse])
def list_images(db: Session = Depends(get_db)):
    """Metadata only — frontend fetches binaries via /images/{id}/binary."""
    return (
        db.query(CustomerDisplayImage)
        .order_by(CustomerDisplayImage.sort_order, CustomerDisplayImage.id)
        .all()
    )


@public_router.get(
    "/images/{image_id}/binary",
    responses={
        200: {"content": {"image/jpeg": {}, "image/png": {}}},
        404: {"description": "Image not found"},
    },
)
def get_image_binary(image_id: int, db: Session = Depends(get_db)) -> Response:
    """Stream the raw bytes with a 1-hour browser cache."""
    img = (
        db.query(CustomerDisplayImage)
        .filter(CustomerDisplayImage.id == image_id)
        .first()
    )
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(
        content=bytes(img.data),
        media_type=img.content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Length": str(img.size_bytes),
        },
    )


# ── Admin endpoints ─────────────────────────────────────────────────────────

@admin_router.post(
    "/images",
    response_model=CustomerDisplayImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Upload a single image. Rejects when the cap or per-file rules are hit."""

    # Cap check first — fail fast before reading the body.
    current_count = db.query(CustomerDisplayImage).count()
    if current_count >= MAX_IMAGES:
        raise HTTPException(
            status_code=422,
            detail=f"Maximum {MAX_IMAGES} images allowed. Delete one before uploading.",
        )

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Only JPG and PNG images are supported.",
        )

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=422,
            detail=f"File too large. Maximum size is {MAX_BYTES // (1024 * 1024)} MB.",
        )

    # New images land at the end of the rotation.
    last_order = (
        db.query(CustomerDisplayImage)
        .order_by(CustomerDisplayImage.sort_order.desc())
        .first()
    )
    next_order = (last_order.sort_order + 1) if last_order else 0

    img = CustomerDisplayImage(
        data=data,
        content_type=file.content_type,
        filename=file.filename,
        size_bytes=len(data),
        sort_order=next_order,
        uploaded_by=current_user.id,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


@admin_router.delete(
    "/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_image(
    image_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    img = (
        db.query(CustomerDisplayImage)
        .filter(CustomerDisplayImage.id == image_id)
        .first()
    )
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    db.delete(img)
    db.commit()


@admin_router.patch(
    "/images/order", response_model=List[CustomerDisplayImageResponse]
)
def reorder_images(
    body: CustomerDisplayImageReorder,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Reassign sort_order so it matches `body.ordered_ids` exactly."""
    existing = {
        img.id: img
        for img in db.query(CustomerDisplayImage).all()
    }
    # Validate every id in the payload — refuse partial reorders so the
    # client and DB never disagree.
    missing = [i for i in body.ordered_ids if i not in existing]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown image id(s): {missing}",
        )
    if set(body.ordered_ids) != set(existing.keys()):
        raise HTTPException(
            status_code=422,
            detail="ordered_ids must include every existing image exactly once.",
        )

    for new_index, image_id in enumerate(body.ordered_ids):
        existing[image_id].sort_order = new_index
    db.commit()
    return (
        db.query(CustomerDisplayImage)
        .order_by(CustomerDisplayImage.sort_order, CustomerDisplayImage.id)
        .all()
    )
