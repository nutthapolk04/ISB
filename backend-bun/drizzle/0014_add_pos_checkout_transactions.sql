CREATE TYPE "public"."checkouttransactionstatus" AS ENUM('pending', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "pos_checkout_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_code" varchar(50),
	"status" "checkouttransactionstatus" DEFAULT 'pending' NOT NULL,
	"transaction_mode" varchar(20),
	"payment_method" varchar(30) NOT NULL,
	"shop_id" varchar(50),
	"cashier_user_id" integer,
	"payer_kind" varchar(20),
	"payer_id" integer,
	"items_count" integer,
	"amount" numeric(10, 2),
	"receipt_id" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos_checkout_transactions" ADD CONSTRAINT "pos_checkout_transactions_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_checkout_transactions" ADD CONSTRAINT "pos_checkout_transactions_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_pos_checkout_txn_created_at" ON "pos_checkout_transactions" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_pos_checkout_txn_shop" ON "pos_checkout_transactions" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_pos_checkout_txn_status" ON "pos_checkout_transactions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "ix_pos_checkout_txn_ref_code" ON "pos_checkout_transactions" USING btree ("ref_code" text_ops);