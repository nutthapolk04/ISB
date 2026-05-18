"""
User, Role, and Permission Models
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base

# Many-to-Many relationship table: User <-> Role
user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

# Many-to-Many relationship table: Role <-> Permission
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", Integer, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    """User model for authentication and authorization"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    role = Column(String(20), nullable=True, default="cashier", server_default="cashier")
    # admin | manager | cashier | parent | staff | student | teacher | canteen_owner | visitor
    terminal_id = Column(String(50), nullable=True)  # Assigned POS terminal
    # Phase 3.5 — PowerSchool integration
    external_id = Column(String(50), nullable=True, index=True)   # PowerSchool ID (mutable)
    family_code = Column(String(20), nullable=True, index=True)   # Permanent family group
    photo_url = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, default="active", server_default="active")  # active | inactive
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    allergies = Column(Text, nullable=True)
    # Phase 3.5b — PowerSchool payload fidelity
    card_uid = Column(String(50), nullable=True, index=True)      # Hex RFID UID
    customer_type = Column(String(20), nullable=True)             # "Staff" | "Parent" (PS enum)
    # Sitemap v2 — shop scoping for cashiers/managers
    shop_id = Column(String(50), ForeignKey("shops.id", ondelete="SET NULL"), nullable=True, index=True)
    # Canteen multi-stall: "canteen" | "store" | null. Populated at user creation for area managers (shop_id=null)
    shop_module = Column(String(20), nullable=True)
    # Department association — staff members linked to their department for dept-charge auto-fill
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    # Feature 9: multi-login restriction — rotated on every login
    session_token = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    roles = relationship("Role", secondary=user_roles, back_populates="users")
    shop = relationship("Shop")
    department = relationship("Department", foreign_keys=[department_id])
    wallet = relationship(
        "Wallet",
        back_populates="user",
        uselist=False,
        foreign_keys="Wallet.user_id",
    )

    def __repr__(self):
        return f"<User(id={self.id}, username='{self.username}', email='{self.email}')>"


class Role(Base):
    """Role model for role-based access control"""

    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)  # e.g., 'admin', 'manager', 'cashier'
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    users = relationship("User", secondary=user_roles, back_populates="roles")
    permissions = relationship("Permission", secondary=role_permissions, back_populates="roles")

    def __repr__(self):
        return f"<Role(id={self.id}, name='{self.name}')>"


class Permission(Base):
    """Permission model for granular access control"""

    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)  # e.g., 'view_cost_price', 'approve_returns'
    resource = Column(String(50), nullable=False)  # e.g., 'product', 'receipt', 'wallet'
    action = Column(String(50), nullable=False)  # e.g., 'create', 'read', 'update', 'delete'
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    roles = relationship("Role", secondary=role_permissions, back_populates="permissions")

    def __repr__(self):
        return f"<Permission(id={self.id}, name='{self.name}')>"
