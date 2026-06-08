import logging
from typing import Optional, Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.payment_intent import PaymentIntent, PaymentIntentStatus
from app.services.wallet_service import WalletService

logger = logging.getLogger(__name__)
router = APIRouter()


class BayCallbackBody(BaseModel):
    transactionNo: Optional[str] = None
    reference1: Optional[str] = None
    reference2: Optional[str] = None
    orderRef: Optional[str] = None
    amount: float
    status: Literal["COMPLETED", "FAILED"]


@router.post("/callback")
def bay_callback(body: BayCallbackBody, db: Session = Depends(get_db)):
    """PYMT posts here when BAY confirms QR or EASYPay payment."""
    intent = None
    if body.orderRef:
        intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == body.orderRef).first()
    elif body.transactionNo:
        intent = db.query(PaymentIntent).filter(PaymentIntent.txn_no == body.transactionNo).first()
        if not intent and body.reference1:
            intent = db.query(PaymentIntent).filter(PaymentIntent.ref_code == body.reference1).first()

    if not intent:
        logger.warning(f"BAY callback: intent not found orderRef={body.orderRef} txnNo={body.transactionNo}")
        return {"received": True}

    if intent.status == PaymentIntentStatus.confirmed:
        return {"received": True}

    if body.status == "COMPLETED":
        try:
            WalletService.confirm_topup(db, intent.ref_code, None, confirmed_via="gateway_webhook")
            logger.info(f"BAY callback confirmed intent {intent.ref_code}")
        except Exception as e:
            logger.error(f"BAY callback confirm failed for {intent.ref_code}: {e}")
            db.rollback()
    elif body.status == "FAILED":
        intent.status = PaymentIntentStatus.cancelled
        db.commit()
        logger.info(f"BAY callback failed intent {intent.ref_code}")

    return {"received": True}
