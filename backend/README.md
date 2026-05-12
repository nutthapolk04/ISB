# ISB Coop POS — Backend

FastAPI + PostgreSQL backend for the ISB Cooperative POS System.

## Quick Start

### 1. Prerequisites
- Python 3.11+
- PostgreSQL 15+

### 2. Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Create database

```bash
psql -U postgres -c "CREATE DATABASE isb_coop_pos;"
```

### 4. Configure environment

Edit `backend/.env` — update `DATABASE_URL`:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/isb_coop_pos
```

### 5. Run migrations

```bash
alembic upgrade head
```

### 6. Seed data

```bash
python seed.py
```

Creates 4 shops + sample products + admin user (`admin` / `admin1234`).

### 7. Start server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Docs: http://localhost:8000/docs

---

## API Endpoints (Phase 1)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login → JWT |
| GET | `/api/v1/shops` | List shops |
| POST | `/api/v1/shops` | Create shop (admin) |
| GET | `/api/v1/shops/{id}/stats` | KPI stats |
| GET | `/api/v1/shops/{id}/categories` | List categories |
| POST | `/api/v1/shops/{id}/categories` | Create category |
| GET | `/api/v1/shops/{id}/products` | List products |
| POST | `/api/v1/shops/{id}/products` | Create product |
| PATCH | `/api/v1/shops/{id}/products/{pid}` | Update product |
| DELETE | `/api/v1/shops/{id}/products/{pid}` | Soft delete |
| GET | `/api/v1/shops/{id}/products/{pid}/fifo-lots` | FIFO lots |
| POST | `/api/v1/shops/{id}/receive` | Receive stock (batch) |
| POST | `/api/v1/shops/{id}/adjust` | Adjust stock |
| GET | `/api/v1/shops/{id}/movements` | Movement log |

All routes require `Authorization: Bearer <token>` except login.

---

## Technology Stack

- **Framework**: FastAPI 0.109.0
- **Database**: PostgreSQL 15+
- **ORM**: SQLAlchemy 2.0
- **Migration**: Alembic
- **Authentication**: JWT (python-jose)
- **Password Hashing**: bcrypt
- **Python**: 3.11+

## Project Structure

```
backend/
├── alembic/                 # Database migrations
│   ├── versions/           # Migration files
│   ├── env.py             # Alembic environment
│   └── script.py.mako     # Migration template
├── app/
│   ├── __init__.py
│   ├── main.py            # FastAPI app entry point
│   ├── core/              # Core functionality
│   │   ├── config.py      # Settings
│   │   ├── database.py    # Database connection
│   │   └── security.py    # Auth & security
│   ├── models/            # SQLAlchemy models
│   │   ├── user.py
│   │   ├── product.py
│   │   ├── receipt.py
│   │   └── ...
│   ├── schemas/           # Pydantic schemas
│   │   └── product.py
│   ├── api/               # API routes
│   │   ├── deps.py        # Dependencies
│   │   └── v1/
│   │       └── products.py
│   ├── services/          # Business logic
│   │   └── product_service.py
│   └── utils/             # Utilities
├── tests/                 # Test files
├── requirements.txt       # Python dependencies
├── .env.example          # Environment variables template
├── .env                  # Environment variables (create this)
└── alembic.ini           # Alembic configuration
```

## Setup Instructions

### 1. Prerequisites

- Python 3.11 or higher
- PostgreSQL 15 or higher
- pip or poetry

### 2. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 3. Database Setup

Create a PostgreSQL database:

```sql
CREATE DATABASE bookstore_pos;
CREATE USER pos_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE bookstore_pos TO pos_user;
```

### 4. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Database
DATABASE_URL=postgresql://pos_user:your_password@localhost:5432/bookstore_pos

# Security
SECRET_KEY=your-secret-key-here-change-this

# App
DEBUG=True
ENVIRONMENT=development
```

### 5. Run Migrations

```bash
# Initialize Alembic (if not done)
alembic init alembic

# Create initial migration
alembic revision --autogenerate -m "Initial migration"

# Apply migrations
alembic upgrade head
```

### 6. Run the Application

```bash
# Development mode with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Or using Python
python -m app.main
```

The API will be available at: `http://localhost:8000`

### 7. Access API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## API Endpoints

### Health Check
- `GET /` - Welcome message
- `GET /health` - Health check

### Products (v1)
- `GET /api/v1/products/search?q={query}` - Search products
- `GET /api/v1/products/{id}` - Get product by ID
- `GET /api/v1/products` - List products with pagination
- `POST /api/v1/products` - Create product
- `PUT /api/v1/products/{id}` - Update product
- `DELETE /api/v1/products/{id}` - Delete product (soft)
- `GET /api/v1/products/barcode/{barcode}` - Get by barcode

## Development Workflow

### Creating Database Migrations

After modifying models:

```bash
# Auto-generate migration
alembic revision --autogenerate -m "Description of changes"

# Review the generated migration file in alembic/versions/

# Apply migration
alembic upgrade head

# Rollback migration (if needed)
alembic downgrade -1
```

### Running Tests

```bash
pytest

# With coverage
pytest --cov=app --cov-report=html
```

### Code Quality

```bash
# Format code
black app/

# Lint code
flake8 app/

# Type checking
mypy app/
```

## Database Models

### Core Models

1. **User, Role, Permission** - Authentication & Authorization
2. **Product, ProductVariant, Category** - Product management
3. **Barcode** - Barcode tracking
4. **StockLevel, InventoryTransaction** - Inventory management
5. **Receipt, ReceiptItem** - Sales transactions
6. **Customer, CustomerType** - Customer management
7. **Wallet, WalletTransaction** - Wallet system
8. **Department, BudgetTransaction** - Budget control
9. **CreditNote** - Returns & refunds
10. **ApprovalRequest** - Approval workflow
11. **AuditLog** - Audit trail

## Security

### Authentication

The API uses JWT (JSON Web Tokens) for authentication.

**Login Flow** (to be implemented):
1. POST credentials to `/api/v1/auth/login`
2. Receive access token and refresh token
3. Include access token in `Authorization: Bearer {token}` header
4. Refresh token when expired

### Role-Based Access Control (RBAC)

Roles:
- **Admin**: Full system access
- **Manager**: Management operations
- **Cashier**: POS operations only (no cost price visibility)
- **Staff**: Limited access

## Environment Variables Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `SECRET_KEY` | JWT secret key | Required |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token expiry time | 30 |
| `DEBUG` | Debug mode | True |
| `CORS_ORIGINS` | Allowed CORS origins | localhost:5173 |

## Troubleshooting

### Database Connection Error

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U pos_user -d bookstore_pos
```

### Migration Issues

```bash
# Check current revision
alembic current

# View migration history
alembic history

# Stamp database to specific revision
alembic stamp head
```

### Import Errors

```bash
# Ensure you're in the backend directory
cd backend

# Run with Python module syntax
python -m app.main
```

## Production Deployment

### Using Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Using Gunicorn

```bash
pip install gunicorn

gunicorn app.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
```

## Contributing

1. Follow PEP 8 style guide
2. Write tests for new features
3. Update documentation
4. Run code quality tools before committing

## License

Proprietary - Bookstore POS System

## Support

For issues and questions, refer to the main project documentation.
