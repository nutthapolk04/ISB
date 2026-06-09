"""
Email delivery service — dispatches transactional mail via Resend HTTP API
or classic SMTP. Picks the transport at call time so deployments can swap
providers via env vars alone:

    1. RESEND_API_KEY set → HTTPS POST to api.resend.com/emails
    2. SMTP_HOST set      → smtplib (STARTTLS or implicit SSL by port)
    3. neither set        → EmailDeliveryError ('not configured')

Resend is the recommended path on Railway and other PaaS providers that
block outbound SMTP ports; SMTP stays available for self-hosted setups.
"""
from __future__ import annotations

import json
import logging
import smtplib
import socket
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"


class EmailDeliveryError(Exception):
    """Raised when an email could not be sent — caller decides whether to retry."""


def is_configured() -> bool:
    """True when any supported transport has the minimum settings."""
    if settings.RESEND_API_KEY:
        return True
    if settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
        return True
    return False


def _resolved_from() -> str:
    """Return the From header value, preferring EMAIL_FROM if set."""
    if settings.EMAIL_FROM:
        return settings.EMAIL_FROM
    addr = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
    name = settings.SMTP_FROM_NAME or settings.EMAIL_FROM_FALLBACK_NAME
    if name and addr:
        return f"{name} <{addr}>"
    return addr


def send_email(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: Optional[str] = None,
) -> None:
    """Send a single email via Resend (preferred) or SMTP (fallback).

    Raises EmailDeliveryError on any failure so the caller can log and decide
    whether to retry. Caller is responsible for persisting an audit record —
    this function intentionally has no side effects beyond network I/O.
    """
    if settings.RESEND_API_KEY:
        _send_via_resend(to=to, subject=subject, body_html=body_html, body_text=body_text)
        return
    if not (settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD):
        raise EmailDeliveryError(
            "Email transport not configured — set RESEND_API_KEY or SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD"
        )
    _send_via_smtp(to=to, subject=subject, body_html=body_html, body_text=body_text)


def _send_via_resend(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: Optional[str],
) -> None:
    from_addr = _resolved_from()
    if not from_addr:
        raise EmailDeliveryError("EMAIL_FROM not set — Resend requires a verified sender address")

    payload = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": body_html,
    }
    if body_text:
        payload["text"] = body_text

    req = urllib.request.Request(
        RESEND_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            # Drain body so the audit log can include the resend id if needed.
            _ = resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        logger.warning("Resend %s for to=%s subject=%r body=%s", exc.code, to, subject, body)
        raise EmailDeliveryError(f"Resend HTTP {exc.code}: {body}") from exc
    except Exception as exc:
        logger.warning("Resend request failed to=%s subject=%r: %s", to, subject, exc)
        raise EmailDeliveryError(f"Resend request failed: {exc}") from exc


def _send_via_smtp(
    *,
    to: str,
    subject: str,
    body_html: str,
    body_text: Optional[str],
) -> None:

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _resolved_from()
    msg["To"] = to
    msg.set_content(body_text or _html_to_text(body_html))
    msg.add_alternative(body_html, subtype="html")

    # Resolve the SMTP host to an IPv4 address explicitly. Railway containers
    # often lack working IPv6 egress, and smtplib's default getaddrinfo can
    # hand back an AAAA record first → ENETUNREACH. Forcing AF_INET keeps the
    # connection on IPv4 where outbound TCP/587 actually works.
    try:
        ipv4 = socket.getaddrinfo(settings.SMTP_HOST, settings.SMTP_PORT, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    except Exception as exc:
        raise EmailDeliveryError(f"DNS resolution failed for {settings.SMTP_HOST}: {exc}") from exc

    # Port 465 → implicit SSL (SMTPS). Port 587/25 → STARTTLS upgrade. We
    # pick by port rather than the explicit SMTP_USE_TLS flag so operators
    # can switch to port 465 by env change alone — useful when a hosting
    # provider blocks 587 but allows 465.
    use_implicit_ssl = settings.SMTP_PORT == 465

    try:
        if use_implicit_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(ipv4, settings.SMTP_PORT, timeout=15, context=context) as server:
                server.ehlo(settings.SMTP_HOST)
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
        elif settings.SMTP_USE_TLS:
            context = ssl.create_default_context()
            with smtplib.SMTP(ipv4, settings.SMTP_PORT, timeout=15) as server:
                server.ehlo(settings.SMTP_HOST)
                server.starttls(context=context)
                server.ehlo(settings.SMTP_HOST)
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP(ipv4, settings.SMTP_PORT, timeout=15) as server:
                server.ehlo(settings.SMTP_HOST)
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
