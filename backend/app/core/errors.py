"""
Domain error types — carry a stable error code + params so the frontend can
localize them, with a fallback message for direct display when no translation
is registered.

Usage (service layer):
    raise BusinessRuleError(
        code="INSUFFICIENT_USER_WALLET",
        params={"balance": 50.0, "amount": 80.0},
        message=f"ยอดเงินใน wallet ไม่พอ. คงเหลือ ฿{...}",  # fallback display
    )

Usage (router layer):
    try:
        ...
    except BusinessRuleError as e:
        raise HTTPException(status_code=400, detail=e.to_detail())

The router converts to HTTPException with structured detail dict; the frontend
ApiError client detects the dict shape and maps `code` → i18n key.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


class BusinessRuleError(Exception):
    """Raised by service layer when a business rule blocks an operation.

    Carries a stable `code` (machine-readable) plus optional `params` for
    string interpolation and a `message` fallback for clients that don't
    know the code.
    """

    def __init__(
        self,
        code: str,
        params: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
    ) -> None:
        self.code = code
        self.params = params or {}
        self.message = message or code
        super().__init__(self.message)

    def to_detail(self) -> Dict[str, Any]:
        return {"code": self.code, "params": self.params, "message": self.message}
