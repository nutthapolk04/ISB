CREATE TABLE "pos_failed_checkouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" varchar(20) NOT NULL,
	"shop_id" varchar(50),
	"cashier_user_id" integer,
	"payment_method" varchar(30),
	"transaction_mode" varchar(30),
	"amount" numeric(10, 2),
	"cart_snapshot" jsonb,
	"error_code" varchar(64),
	"error_message" text,
	"idempotency_key" varchar(64),
	"edc_approval_code" varchar(32),
	"edc_terminal_ref" varchar(50),
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_failed_checkouts" ADD CONSTRAINT "pos_failed_checkouts_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_pos_failed_checkouts_created_at" ON "pos_failed_checkouts" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_pos_failed_checkouts_shop" ON "pos_failed_checkouts" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_pos_failed_checkouts_idempotency_key" ON "pos_failed_checkouts" USING btree ("idempotency_key" text_ops);
