"""
EmailAlertLog — audit trail of every notification email the system attempted
to deliver. Lets admins answer 'did parent X get notified when Y happened?'
without re-running SMTP traces.
"""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.sql import func
from app.core.database import Base


class EmailAlertLog(Base):
    __tablename__ = "email_alerts_log"

    id = Column(Integer, primary_key=True, index=True)
    alert_type = Column(String(40), nullable=False, index=True)  # "low_balance" | ...
    recipient_email = Column(String(255), nullable=False)
    parent_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    child_customer_id = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)

    subject = Column(String(500), nullable=False)
    # Capture enough context to debug a delivery question. Body kept short
    # (HTML is rendered at send-time; we store the resolved data values).
    threshold_amount = Column(Numeric(10, 2), nullable=True)
    balance_at_alert = Column(Numeric(10, 2), nullable=True)

    status = Column(String(20), nullable=False, default="sent")  # sent | failed
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    def __repr__(self):
        return f"<EmailAlertLog(id={self.id}, type='{self.alert_type}', to='{self.recipient_email}', status='{self.status}')>"
