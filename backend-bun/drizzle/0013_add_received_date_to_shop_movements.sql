ALTER TABLE "shop_movements" ADD COLUMN "received_date" date;--> statement-breakpoint
-- Backfill: existing receives have no recorded delivery date, so the closest
-- truthful value is the day the record was created. Only 'receive' rows are
-- touched — received_date is meaningless on a sale/adjustment/void and stays
-- null there so the report can print "-" rather than a misleading date.
UPDATE "shop_movements"
SET "received_date" = ("created_at" AT TIME ZONE 'Asia/Bangkok')::date
WHERE "type" = 'receive' AND "received_date" IS NULL;
