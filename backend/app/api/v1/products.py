"""
Product API Endpoints
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, check_permission
from app.models.user import User
from app.schemas.product import (
    ProductCreate,
    ProductUpdate,
    ProductResponse,
    ProductSearchResponse,
    ProductVariantResponse,
)
from app.services.product_service import ProductService

router = APIRouter()


@router.get("/search", response_model=List[ProductVariantResponse])
async def search_products(
    q: str = Query(..., min_length=1, description="Search query"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Search products by name, SKU, or barcode.
    Fast search optimized for POS usage.

    - **q**: Search query string
    - **skip**: Number of items to skip (pagination)
    - **limit**: Number of items to return (max 100)
    """
    product_service = ProductService(db)

    # Search by barcode first (exact match)
    variant = product_service.get_by_barcode(q)
    if variant:
        # Add stock quantity to response
        if variant.stock_levels:
            variant.stock_quantity = variant.stock_levels[0].quantity
        return [variant]

    # Search by name or SKU (partial match)
    variants = product_service.search(
        query=q,
        skip=skip,
        limit=limit,
        include_stock=True
    )

    # Add stock quantities to responses
    for variant in variants:
        if variant.stock_levels:
            variant.stock_quantity = variant.stock_levels[0].quantity

    return variants


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get product details by ID.

    - **product_id**: Product ID
    """
    product_service = ProductService(db)
    product = product_service.get_product(product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )

    # Add stock quantities to variants
    for variant in product.variants:
        if variant.stock_levels:
            variant.stock_quantity = variant.stock_levels[0].quantity

    return product


@router.get("/", response_model=List[ProductResponse])
async def get_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    category_id: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all products with pagination and filters.

    - **skip**: Number of items to skip
    - **limit**: Number of items to return
    - **category_id**: Filter by category
    - **is_active**: Filter by active status
    """
    product_service = ProductService(db)
    products = product_service.get_products(
        skip=skip,
        limit=limit,
        category_id=category_id,
        is_active=is_active
    )

    # Add stock quantities
    for product in products:
        for variant in product.variants:
            if variant.stock_levels:
                variant.stock_quantity = variant.stock_levels[0].quantity

    return products


@router.post("/", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_permission("create_product"))
):
    """
    Create a new product.

    - **product_data**: Product data including variants
    """
    product_service = ProductService(db)
    product = product_service.create_product(product_data, current_user.id)

    return product


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_permission("update_product"))
):
    """
    Update a product.

    - **product_id**: Product ID
    - **product_data**: Updated product data
    """
    product_service = ProductService(db)
    product = product_service.update_product(product_id, product_data)

    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(check_permission("delete_product"))
):
    """
    Delete a product (soft delete).

    - **product_id**: Product ID
    """
    product_service = ProductService(db)
    product_service.delete_product(product_id)

    return None


@router.get("/barcode/{barcode}", response_model=ProductVariantResponse)
async def get_product_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get product variant by barcode.
    Optimized for barcode scanning in POS.

    - **barcode**: Product barcode
    """
    product_service = ProductService(db)
    variant = product_service.get_by_barcode(barcode)

    if not variant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found for this barcode"
        )

    # Add stock quantity
    if variant.stock_levels:
        variant.stock_quantity = variant.stock_levels[0].quantity

    return variant
