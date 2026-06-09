"""
Notification service — wraps the alert-decision logic around the raw email
sender. Decides *whether* to send (threshold crossed, cooldown elapsed) and
records every attempt to the audit log.

Kept separate from email_service.py so that future channels (LINE, SMS, push)
can hook into the same decision flow without touching SMTP code.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.customer import Customer
from app.models.email_alert_log import EmailAlertLog
from app.models.parent_child_link import ParentChildLink
from app.models.user import User
from app.services import email_service

logger = logging.getLogger(__name__)


def maybe_send_low_balance_alert(
    db: Session,
    *,
    customer: Customer,
    old_balance: Decimal,
    new_balance: Decimal,
) -> None:
    """Fire low-balance alert emails when this customer's balance dropped
    across a parent's configured threshold.

    Designed to be called from inside the same transaction that just deducted
    the wallet — callers should commit after this returns. Failures are
    swallowed (logged + recorded) so a flaky SMTP server never blocks a sale.
    """
    # Only fire on a DOWNWARD movement — top-ups should never alert.
    if new_balance >= old_balance:
        return

    # Find every parent that has alerts enabled for this child.
    links = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.child_customer_id == customer.id,
            ParentChildLink.low_balance_alert_enabled == True,  # noqa: E712
            ParentChildLink.low_balance_threshold.isnot(None),
        )
        .all()
    )
    if not links:
        return

    now = datetime.now(timezone.utc)
    cooldown = timedelta(hours=settings.LOW_BALANCE_ALERT_COOLDOWN_HOURS)

    for link in links:
        threshold = Decimal(str(link.low_balance_threshold))
        # Hysteresis: only fire when the balance just *crossed* the threshold
        # going downward. Subsequent drops while still below the threshold do
        # not re-trigger — the parent already knows.
        if old_balance < threshold:
            continue
        if new_balance >= threshold:
            continue

        # Cooldown — even on a fresh crossing, don't spam within N hours.
        if link.last_low_balance_alert_at is not None:
            last = link.last_low_balance_alert_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if now - last < cooldown:
                continue

        _dispatch_low_balance_email(
            db,
            link=link,
            customer=customer,
            balance=new_balance,
            threshold=threshold,
            now=now,
        )


def _dispatch_low_balance_email(
    db: Session,
    *,
    link: ParentChildLink,
    customer: Customer,
    balance: Decimal,
    threshold: Decimal,
    now: datetime,
) -> None:
    parent: Optional[User] = link.parent
    if not parent:
        logger.warning("ParentChildLink id=%s has no parent user attached", link.id)
        return

    recipient = (parent.email or "").strip()
    if not recipient:
        logger.info("Parent user_id=%s has no email — skipping low-balance alert", parent.id)
        return

    topup_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/parent/wallet/{customer.id}"
    subject, html_body = email_service.render_low_balance_email(
        child_name=customer.name or f"นักเรียน #{customer.id}",
        balance=float(balance),
        threshold=float(threshold),
        topup_url=topup_url,
    )

    log_entry = EmailAlertLog(
        alert_type="low_balance",
        recipient_email=recipient,
        parent_user_id=parent.id,
        child_customer_id=customer.id,
        subject=subject,
        threshold_amount=threshold,
        balance_at_alert=balance,
        status="sent",
    )

    try:
        email_service.send_email(to=recipient, subject=subject, body_html=html_body)
        link.last_low_balance_alert_at = now
    except email_service.EmailDeliveryError as exc:
        log_entry.status = "failed"
        log_entry.error_message = str(exc)[:2000]
        logger.warning("low-balance email failed customer=%s parent=%s: %s", customer.id, parent.id, exc)
    except Exception as exc:  # defensive — never let alerts break the sale
        log_entry.status = "failed"
        log_entry.error_message = f"unexpected: {type(exc).__name__}: {exc}"[:2000]
        logger.exception("unexpected error sending low-balance email")

    db.add(log_entry)
