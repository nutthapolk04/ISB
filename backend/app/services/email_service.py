"""
Email delivery service — thin SMTP wrapper used for transactional notifications.

The system supports any SMTP server (Gmail App Password, AWS SES SMTP relay,
Office 365 SMTP, etc.) so deployments can swap providers without touching code.
Set the SMTP_* env vars in Railway to enable delivery.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """Raised when an email could not be sent — caller decides whether to retry."""


def is_configured() -> bool:
    """True when enough SMTP settings exist to attempt delivery."""
    return bool(settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD)


def send_email(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: Optional[str] = None,
) -> None:
    """Send a single email via configured SMTP server.

    Raises EmailDeliveryError on any failure so the caller can log and decide
    whether to retry. Caller is responsible for persisting an audit record —
    this function intentionally has no side effects beyond network I/O.
    """
    if not is_configured():
        raise EmailDeliveryError("SMTP not configured — set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD")

    msg = EmailMessage()
    msg["Subject"] = subject
    from_addr = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
    if settings.SMTP_FROM_NAME:
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{from_addr}>"
    else:
        msg["From"] = from_addr
    msg["To"] = to
    msg.set_content(body_text or _html_to_text(body_html))
    msg.add_alternative(body_html, subtype="html")

    try:
        if settings.SMTP_USE_TLS:
            context = ssl.create_default_context()
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.starttls(context=context)
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
    except Exception as exc:  # broad on purpose — SMTP exposes many failure modes
        logger.warning("Email delivery failed to=%s subject=%r: %s", to, subject, exc)
        raise EmailDeliveryError(str(exc)) from exc


def _html_to_text(html: str) -> str:
    """Quick & dirty HTML→text fallback so the multipart message always has a
    plain-text alternative for clients that strip HTML."""
    import re

    text = re.sub(r"<\s*br\s*/?\s*>", "\n", html, flags=re.I)
    text = re.sub(r"</\s*p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def render_low_balance_email(
    *,
    child_name: str,
    balance: float,
    threshold: float,
    topup_url: str,
) -> tuple[str, str]:
    """Return (subject, html_body) for the low-balance alert email."""
    subject = f"📉 [ISB] ยอดเงิน {child_name} เหลือ ฿{balance:,.2f}"
    html = f"""
    <!DOCTYPE html>
    <html lang="th">
    <head><meta charset="utf-8"><title>{subject}</title></head>
    <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <h1 style="margin:0 0 16px;font-size:20px;color:#1f2937;">แจ้งเตือนยอดเงินต่ำ</h1>
        <p style="color:#374151;line-height:1.6;margin:0 0 16px;">
          ยอดเงินในกระเป๋าของ <strong>{child_name}</strong> เหลือ
          <strong style="color:#dc2626;">฿{balance:,.2f}</strong>
          ซึ่งต่ำกว่าระดับที่คุณตั้งไว้ที่ ฿{threshold:,.2f}
        </p>
        <p style="margin:24px 0;">
          <a href="{topup_url}" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
            เติมเงินทันที →
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;line-height:1.5;margin:24px 0 0;">
          อีเมลนี้ถูกส่งโดยอัตโนมัติเนื่องจากคุณเปิดการแจ้งเตือนยอดเงินต่ำในระบบของ International School Bangkok.
          หากต้องการปิดการแจ้งเตือน เข้าระบบและเปลี่ยนการตั้งค่าได้ที่หน้า "ลูกของฉัน"
        </p>
      </div>
    </body>
    </html>
    """.strip()
    return subject, html
