"""
FastAPI Application Entry Point
Bookstore POS System Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.responses import JSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.config import settings
from app.core.database import engine, Base

from app.models import price_panel as _price_panel_models  # noqa: F401 — ensures tables are created

# Import routers
from app.api.v1 import (
    products, auth, shops, inventory, pos, returns, wallets, customers,
    family, users, users_admin, sync,
    admin_cardholders, admin_departments, admin_audit, admin_settings, departments, reports,
    uom, bundles, price_panels, canteen, admin_import,
)

# Create database tables (idempotent — won't drop existing data)
# Note: seeding is handled by start.sh before uvicorn is launched.
Base.metadata.create_all(bind=engine)

# Initialize FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production-grade POS system for bookstores and educational institutions",
    debug=settings.DEBUG,
)

# Trust Railway's reverse proxy so HTTPS scheme is preserved in redirects
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint - API health check"""
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "status": "online",
        "environment": settings.ENVIRONMENT,
    }


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
    }


# API v1 routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(products.router, prefix="/api/v1/products", tags=["Products"])
app.include_router(shops.router, prefix="/api/v1/shops", tags=["Shops"])
app.include_router(inventory.router, prefix="/api/v1/shops", tags=["Inventory"])
app.include_router(pos.router, prefix="/api/v1/pos", tags=["POS"])
app.include_router(returns.router, prefix="/api/v1", tags=["Returns"])
app.include_router(wallets.router, prefix="/api/v1/wallets", tags=["Wallets"])
app.include_router(customers.router, prefix="/api/v1/customers", tags=["Customers"])
app.include_router(family.router, prefix="/api/v1/family", tags=["Family"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(users_admin.router, prefix="/api/v1/users-admin", tags=["User Management"])
app.include_router(sync.router, prefix="/api/v1/sync", tags=["PowerSchool Sync"])
app.include_router(admin_cardholders.router, prefix="/api/v1/admin", tags=["Admin Cardholders"])
app.include_router(admin_departments.router, prefix="/api/v1/admin", tags=["Admin Departments"])
app.include_router(admin_audit.router, prefix="/api/v1/admin", tags=["Admin Audit"])
app.include_router(admin_settings.router, prefix="/api/v1/admin/settings", tags=["Admin Settings"])
app.include_router(departments.router, prefix="/api/v1/departments", tags=["Departments"])
app.include_router(reports.router, prefix="/api/v1/reports", tags=["Reports"])
app.include_router(uom.router, prefix="/api/v1/uom", tags=["Units of Measure"])
app.include_router(bundles.router, prefix="/api/v1/shops", tags=["Product Bundles"])
app.include_router(price_panels.router, prefix="/api/v1/shops", tags=["Price Panels"])
app.include_router(canteen.router, prefix="/api/v1/canteen", tags=["Canteen"])
app.include_router(admin_import.router, prefix="/api/v1/admin/import", tags=["Admin Import"])


# Exception handlers
from app.core.errors import BusinessRuleError


@app.exception_handler(BusinessRuleError)
async def business_rule_handler(request, exc: BusinessRuleError):
    """Service-layer business-rule violations. detail is structured (code+params+
    fallback message) so frontend can localize via i18n."""
    return JSONResponse(status_code=400, content={"detail": exc.to_detail()})


@app.exception_handler(404)
async def not_found_handler(request, exc):
    """Custom 404 handler — pass through resource-specific detail messages."""
    detail = getattr(exc, "detail", None)
    # Starlette emits "Not Found" for unmatched routes; replace with friendlier text.
    if not detail or detail == "Not Found":
        detail = "Endpoint not found"
    return JSONResponse(
        status_code=404,
        content={"detail": detail},
    )


@app.exception_handler(500)
async def internal_error_handler(request, exc):
    """Custom 500 handler"""
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
