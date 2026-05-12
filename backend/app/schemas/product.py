"""
Product Pydantic Schemas
"""
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from decimal import Decimal


# Category Schemas
class CategoryBase(BaseModel):
    """Base category schema"""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    parent_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    """Schema for creating a category"""
    pass


class CategoryUpdate(BaseModel):
    """Schema for updating a category"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    parent_id: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryResponse(CategoryBase):
    """Schema for category response"""
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Product Variant Schemas
class ProductVariantBase(BaseModel):
    """Base product variant schema"""
    sku: str = Field(..., min_length=1, max_length=100)
    variant_name: str = Field(..., min_length=1, max_length=255)
    color: Optional[str] = Field(None, max_length=50)
    size: Optional[str] = Field(None, max_length=50)
    barcode: Optional[str] = Field(None, max_length=100)
    cost_price: Decimal = Field(..., ge=0)
    retail_price: Decimal = Field(..., ge=0)
    image_url: Optional[str] = None


class ProductVariantCreate(ProductVariantBase):
    """Schema for creating a product variant"""
    pass


class ProductVariantUpdate(BaseModel):
    """Schema for updating a product variant"""
    sku: Optional[str] = Field(None, min_length=1, max_length=100)
    variant_name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = Field(None, max_length=50)
    size: Optional[str] = Field(None, max_length=50)
    barcode: Optional[str] = Field(None, max_length=100)
    cost_price: Optional[Decimal] = Field(None, ge=0)
    retail_price: Optional[Decimal] = Field(None, ge=0)
    image_url: Optional[str] = None
    is_active: Optional[bool] = None


class ProductVariantResponse(ProductVariantBase):
    """Schema for product variant response"""
    id: int
    product_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    stock_quantity: Optional[int] = None  # From stock level

    model_config = ConfigDict(from_attributes=True)


# Product Schemas
class ProductBase(BaseModel):
    """Base product schema"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    category_id: int
    brand: Optional[str] = Field(None, max_length=100)


class ProductCreate(ProductBase):
    """Schema for creating a product"""
    variants: Optional[List[ProductVariantCreate]] = None


class ProductUpdate(BaseModel):
    """Schema for updating a product"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    category_id: Optional[int] = None
    brand: Optional[str] = Field(None, max_length=100)
    is_active: Optional[bool] = None


class ProductResponse(ProductBase):
    """Schema for product response"""
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    category: Optional[CategoryResponse] = None
    variants: List[ProductVariantResponse] = []

    model_config = ConfigDict(from_attributes=True)


# Search Response
class ProductSearchResponse(BaseModel):
    """Schema for product search results"""
    total: int
    items: List[ProductVariantResponse]
    page: int
    page_size: int
