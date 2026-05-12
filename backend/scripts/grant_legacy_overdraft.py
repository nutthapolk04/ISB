"""
One-shot migration helper: grant per-customer overdraft to wallets that were
already negative before the negative-balance policy change shipped.

Background
----------
Before 2026-05-08 the system allowed any wallet to go negative. After the
policy change, customer wallets are blocked from new deductions unless
`customers.negative_credit_limit` is set. Customers whose wallets were already
negative would suddenly be unable to purchase anything until they top up to >=0.

This script grants those customers a temporary overdraft equal to
`max(abs(current_negative_balance), --limit)` so they can keep transacting
while admins arrange a proper top-up.

Usage (from backend/ dir):
    python scripts/grant_legacy_overdraft.py                 # dry-run, default --limit 200
    python scripts/grant_legacy_overdraft.py --limit 500     # dry-run with custom default
    python scripts/grant_legacy_overdraft.py --apply         # commit changes

Notes
-----
- User wallets are NOT touched (no per-wallet overdraft field exists for them).
  For user wallets that were negative, either toggle the global
  `allow_negative_user_wallet` flag temporarily via /admin/settings or use the
  admin wallet adjust endpoint.
- Customers that already have a `negative_credit_limit` set are skipped — admin
  intent should be respected.
"""
from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal

# Make the backend package importable regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal  # noqa: E402
from app.models.customer import Customer  # noqa: E402
from app.models.wallet import Wallet  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--limit",
        type=float,
        default=200.0,
        help="Default overdraft to grant when |balance| < this value (THB). Default: 200",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit the changes. Without this flag the script runs in dry-run mode.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        rows = (
            db.query(Wallet, Customer)
            .join(Customer, Wallet.customer_id == Customer.id)
            .filter(Wallet.balance < 0)
            .filter(Customer.negative_credit_limit.is_(None))
            .all()
        )

        if not rows:
            print("✓ No customer wallets need a legacy overdraft grant.")
            return 0

        print(f"Found {len(rows)} customer(s) with negative wallet balance and no overdraft set.\n")
        print(f"{'customer_id':>12}  {'name':<30} {'balance':>12} {'new_limit':>12}")
        print("-" * 72)

        updates = []
        for wallet, customer in rows:
            balance = float(wallet.balance)
            new_limit = max(abs(balance), args.limit)
            updates.append((customer, new_limit))
            print(
                f"{customer.id:>12}  {(customer.name or '')[:30]:<30} "
                f"{balance:>12.2f} {new_limit:>12.2f}"
            )

        if not args.apply:
            print(f"\n[DRY RUN] Would update {len(updates)} customer(s). Re-run with --apply to commit.")
            return 0

        for customer, new_limit in updates:
            customer.negative_credit_limit = Decimal(str(new_limit))
        db.commit()
        print(f"\n✓ Granted overdraft to {len(updates)} customer(s).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
