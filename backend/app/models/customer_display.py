"""
Customer Display — admin-managed standby images shown on the second-monitor
customer-facing screen between transactions.

Image bytes live directly in Postgres (BYTEA). Cap is enforced at the API
layer: max 10 images, max 2 MB each, JPG/PNG only. See
`app/api/v1/customer_display.py`.
"""
from sqlalchemy import Column, Integer, String, DateTime, LargeBinary, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class CustomerDisplayImage(Base):
    __tablename__ = "customer_display_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    data = Column(LargeBinary, nullable=False)
    content_type = Column(String(50), nullable=False)  # 'image/jpeg' | 'image/png'
    filename = Column(String(200), nullable=True)
    size_bytes = Column(Integer, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")
    uploaded_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    uploaded_by = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:
        return (
            f"<CustomerDisplayImage id={self.id} "
            f"filename={self.filename!r} size={self.size_bytes}B>"
        )
