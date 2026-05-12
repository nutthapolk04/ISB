"""
Product Service
Business logic for product management
"""
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from fastapi import HTTPException, status

from app.models.product import Product, ProductVariant, Category
from app.models.stock import StockLevel
from app.schemas.product import ProductCreate, ProductUpdate, ProductVariantCreate


class ProductService:
    """Product service for business logic"""

    def __init__(self, db: Session):
        self.db = db

    def get_product(self, product_id: int) -> Optional[Product]:
        """Get a product by ID"""
        return (
            self.db.query(Product)
            .options(
                joinedload(Product.category),
                joinedload(Product.variants).joinedload(ProductVariant.stock_levels)
            )
            .filter(Product.id == product_id)
            .first()
        )

    def get_products(
        self,
        skip: int = 0,
        limit: int = 20,
        category_id: Optional[int] = None,
        is_active: Optional[bool] = None
    ) -> List[Product]:
        """Get products with pagination and filters"""
        query = self.db.query(Product).options(
            joinedload(Product.category),
            joinedload(Product.variants)
        )

        if category_id is not None:
            query = query.filter(Product.category_id == category_id)

        if is_active is not None:
            query = query.filter(Product.is_active == is_active)

        return query.offset(skip).limit(limit).all()

    def create_product(self, product_data: ProductCreate, user_id: int) -> Product:
        """Create a new product"""
        # Check if category exists
        category = self.db.query(Category).filter(Category.id == product_data.category_id).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Category not found"
            )

        # Create product
        product = Product(
            name=product_data.name,
            description=product_data.description,
            category_id=product_data.category_id,
            brand=product_data.brand,
        )

        self.db.add(product)
        self.db.flush()  # Get product ID

        # Create variants if provided
        if product_data.variants:
            for variant_data in product_data.variants:
                variant = ProductVariant(
                    product_id=product.id,
                    **variant_data.model_dump()
                )
                self.db.add(variant)
                self.db.flush()

                # Initialize stock level for variant
                stock = StockLevel(
                    product_variant_id=variant.id,
                    quantity=0,
                    low_stock_threshold=10,
                    updated_by=user_id
                )
                self.db.add(stock)

        self.db.commit()
        self.db.refresh(product)

        return product

    def update_product(self, product_id: int, product_data: ProductUpdate) -> Product:
        """Update a product"""
        product = self.get_product(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found"
            )

        # Update fields
        update_data = product_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(product, field, value)

        self.db.commit()
        self.db.refresh(product)

        return product

    def delete_product(self, product_id: int) -> None:
        """Delete a product (soft delete)"""
        product = self.get_product(product_id)
        if not product:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found"
            )

        product.is_active = False
        self.db.commit()

    def get_by_barcode(self, barcode: str) -> Optional[ProductVariant]:
        """Get product variant by barcode"""
        return (
            self.db.query(ProductVariant)
            .options(joinedload(ProductVariant.stock_levels))
            .filter(ProductVariant.barcode == barcode, ProductVariant.is_active == True)
            .first()
        )

    def search(
        self,
        query: str,
        skip: int = 0,
        limit: int = 20,
        include_stock: bool = False
    ) -> List[ProductVariant]:
        """
        Search products by name, SKU, or barcode
        Optimized for POS usage
        """
        search_query = self.db.query(ProductVariant).join(Product)

        # Search conditions
        search_conditions = or_(
            ProductVariant.sku.ilike(f"%{query}%"),
            ProductVariant.variant_name.ilike(f"%{query}%"),
            ProductVariant.barcode.ilike(f"%{query}%"),
            Product.name.ilike(f"%{query}%")
        )

        search_query = search_query.filter(
            and_(
                search_conditions,
                ProductVariant.is_active == True,
                Product.is_active == True
            )
        )

        if include_stock:
            search_query = search_query.options(joinedload(ProductVariant.stock_levels))

        return search_query.offset(skip).limit(limit).all()
