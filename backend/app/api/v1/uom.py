"""
Unit of Measure (UOM) API
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.api.deps import get_current_user, require_role
from app.models.user import User
from app.models.unit_of_measure import UnitOfMeasure

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class UOMBase(BaseModel):
    code: str
    name: str
    name_en: Optional[str] = None
    base_uom_id: Optional[int] = None
    conversion_factor: float = 1.0


class UOMCreate(UOMBase):
    pass


class UOMUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    name_en: Optional[str] = None
    base_uom_id: Optional[int] = None
    conversion_factor: Optional[float] = None
    is_active: Optional[bool] = None


class UOMResponse(UOMBase):
    id: int
    is_active: bool
    base_uom_code: Optional[str] = None
    base_uom_name: Optional[str] = None

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[UOMResponse])
def list_uoms(
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all units of measure."""
    query = db.query(UnitOfMeasure)
    if active_only:
        query = query.filter(UnitOfMeasure.is_active == True)
    uoms = query.order_by(UnitOfMeasure.code).all()

    result = []
    for uom in uoms:
        base_uom = None
        if uom.base_uom_id:
            base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom.base_uom_id).first()

        result.append(UOMResponse(
            id=uom.id,
            code=uom.code,
            name=uom.name,
            name_en=uom.name_en,
            base_uom_id=uom.base_uom_id,
            conversion_factor=float(uom.conversion_factor),
            is_active=uom.is_active,
            base_uom_code=base_uom.code if base_uom else None,
            base_uom_name=base_uom.name if base_uom else None,
        ))
    return result


@router.get("/{uom_id}", response_model=UOMResponse)
def get_uom(
    uom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific unit of measure."""
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")

    base_uom = None
    if uom.base_uom_id:
        base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom.base_uom_id).first()

    return UOMResponse(
        id=uom.id,
        code=uom.code,
        name=uom.name,
        name_en=uom.name_en,
        base_uom_id=uom.base_uom_id,
        conversion_factor=float(uom.conversion_factor),
        is_active=uom.is_active,
        base_uom_code=base_uom.code if base_uom else None,
        base_uom_name=base_uom.name if base_uom else None,
    )


@router.post("/", response_model=UOMResponse, status_code=status.HTTP_201_CREATED)
def create_uom(
    payload: UOMCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Create a new unit of measure."""
    # Check for duplicate code
    existing = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == payload.code.upper()).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"UOM code '{payload.code}' already exists")

    # Validate base_uom_id if provided
    if payload.base_uom_id:
        base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == payload.base_uom_id).first()
        if not base_uom:
            raise HTTPException(status_code=400, detail="Base UOM not found")

    uom = UnitOfMeasure(
        code=payload.code.upper(),
        name=payload.name,
        name_en=payload.name_en,
        base_uom_id=payload.base_uom_id,
        conversion_factor=payload.conversion_factor,
        is_active=True,
    )
    db.add(uom)
    db.commit()
    db.refresh(uom)

    base_uom = None
    if uom.base_uom_id:
        base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom.base_uom_id).first()

    return UOMResponse(
        id=uom.id,
        code=uom.code,
        name=uom.name,
        name_en=uom.name_en,
        base_uom_id=uom.base_uom_id,
        conversion_factor=float(uom.conversion_factor),
        is_active=uom.is_active,
        base_uom_code=base_uom.code if base_uom else None,
        base_uom_name=base_uom.name if base_uom else None,
    )


@router.patch("/{uom_id}", response_model=UOMResponse)
def update_uom(
    uom_id: int,
    payload: UOMUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "manager")),
):
    """Update a unit of measure."""
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")

    if payload.code is not None:
        existing = db.query(UnitOfMeasure).filter(
            UnitOfMeasure.code == payload.code.upper(),
            UnitOfMeasure.id != uom_id
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail=f"UOM code '{payload.code}' already exists")
        uom.code = payload.code.upper()

    if payload.name is not None:
        uom.name = payload.name
    if payload.name_en is not None:
        uom.name_en = payload.name_en
    if payload.base_uom_id is not None:
        if payload.base_uom_id != 0:
            base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == payload.base_uom_id).first()
            if not base_uom:
                raise HTTPException(status_code=400, detail="Base UOM not found")
            uom.base_uom_id = payload.base_uom_id
        else:
            uom.base_uom_id = None
    if payload.conversion_factor is not None:
        uom.conversion_factor = payload.conversion_factor
    if payload.is_active is not None:
        uom.is_active = payload.is_active

    db.commit()
    db.refresh(uom)

    base_uom = None
    if uom.base_uom_id:
        base_uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom.base_uom_id).first()

    return UOMResponse(
        id=uom.id,
        code=uom.code,
        name=uom.name,
        name_en=uom.name_en,
        base_uom_id=uom.base_uom_id,
        conversion_factor=float(uom.conversion_factor),
        is_active=uom.is_active,
        base_uom_code=base_uom.code if base_uom else None,
        base_uom_name=base_uom.name if base_uom else None,
    )


@router.delete("/{uom_id}")
def delete_uom(
    uom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Delete (deactivate) a unit of measure."""
    uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")

    # Soft delete - just deactivate
    uom.is_active = False
    db.commit()

    return {"success": True, "message": f"UOM '{uom.code}' deactivated"}


@router.post("/seed-defaults")
def seed_default_uoms(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    """Seed default UOMs if not exist."""
    defaults = [
        {"code": "PCS", "name": "ชิ้น", "name_en": "Piece"},
        {"code": "BOX", "name": "กล่อง", "name_en": "Box"},
        {"code": "SET", "name": "ชุด", "name_en": "Set"},
        {"code": "PAIR", "name": "คู่", "name_en": "Pair"},
        {"code": "PACK", "name": "แพ็ค", "name_en": "Pack"},
        {"code": "DOZEN", "name": "โหล", "name_en": "Dozen"},
        {"code": "KG", "name": "กิโลกรัม", "name_en": "Kilogram"},
        {"code": "G", "name": "กรัม", "name_en": "Gram"},
        {"code": "L", "name": "ลิตร", "name_en": "Liter"},
        {"code": "ML", "name": "มิลลิลิตร", "name_en": "Milliliter"},
        {"code": "M", "name": "เมตร", "name_en": "Meter"},
        {"code": "CM", "name": "เซนติเมตร", "name_en": "Centimeter"},
    ]

    created = []
    for item in defaults:
        existing = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == item["code"]).first()
        if not existing:
            uom = UnitOfMeasure(**item)
            db.add(uom)
            created.append(item["code"])

    db.commit()

    return {
        "success": True,
        "created": created,
        "message": f"Created {len(created)} default UOMs" if created else "All default UOMs already exist"
    }
