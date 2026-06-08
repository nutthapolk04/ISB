import re
import httpx
from typing import Optional
from dataclasses import dataclass
from app.core.config import settings

def sanitize_ref(value: str, max_len: int = 20) -> str:
    return re.sub(r'[^A-Za-z0-9]', '', value)[:max_len]

def _is_configured() -> bool:
    return bool(settings.PYMT_BASE_URL and settings.PYMT_MERCHANT_TOKEN)

def _headers(config_app: str) -> dict:
    return {
        "Authorization": f"Basic {settings.PYMT_MERCHANT_TOKEN}",
        "x-config-app": config_app,
        "Content-Type": "application/json",
    }

@dataclass
class QRResult:
    txn_no: str
    qrcode_content: str

@dataclass
class EasyPayResult:
    order_ref: str
    txn_no: str
    payment_page_url: str
    payment_form_params: dict[str, str]

class PymtGatewayError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code

def create_qr_payment(
    amount: float,
    ref_code: str,
    wallet_id: int,
    channel: int = 2,
    expired_minutes: int = 10,
) -> QRResult:
    """Call PYMT to generate a BAY QR code. Returns txn_no + qrcodeContent."""
    if not _is_configured():
        raise PymtGatewayError("PYMT not configured", 503)

    ref1 = sanitize_ref(ref_code, 20)
    ref2 = sanitize_ref(f"W{wallet_id}", 20)

    payload = {
        "amount": amount,
        "ref1": ref1,
        "ref2": ref2,
        "channel": channel,
        "expiredMinutes": expired_minutes,
    }

    url = f"{settings.PYMT_BASE_URL}/api/v1/bay/qr"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, json=payload, headers=_headers("bay.qrPayment"))

    if resp.status_code != 200:
        raise PymtGatewayError(f"PYMT QR error {resp.status_code}: {resp.text}", resp.status_code)

    data = resp.json()
    if data.get("status") != "success":
        raise PymtGatewayError(data.get("message", "PYMT QR failed"))

    d = data["data"]
    return QRResult(txn_no=d["txnNo"], qrcode_content=d["qrcodeContent"])


def create_easypay(
    amount: float,
    ref_code: str,
    success_url: str,
    fail_url: str,
    cancel_url: str,
    lang: str = "T",
) -> EasyPayResult:
    """Call PYMT to register an EASYPay transaction. Returns paymentPageUrl + paymentFormParams."""
    if not _is_configured():
        raise PymtGatewayError("PYMT not configured", 503)

    payload = {
        "amount": amount,
        "orderRef": ref_code,
        "successUrl": success_url,
        "failUrl": fail_url,
        "cancelUrl": cancel_url,
        "currCode": "764",
        "payType": "N",
        "lang": lang,
    }

    url = f"{settings.PYMT_BASE_URL}/api/v1/bay/easypay"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, json=payload, headers=_headers("bay.easypay"))

    if resp.status_code != 200:
        raise PymtGatewayError(f"PYMT EASYPay error {resp.status_code}: {resp.text}", resp.status_code)

    data = resp.json()
    if data.get("status") != "success":
        raise PymtGatewayError(data.get("message", "PYMT EASYPay failed"))

    d = data["data"]
    return EasyPayResult(
        order_ref=d["orderRef"],
        txn_no=d["orderRef"],  # EASYPay: txn_no = orderRef = ref_code
        payment_page_url=d["paymentPageUrl"],
        payment_form_params=d["paymentFormParams"],
    )
