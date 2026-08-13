CREATE TABLE "edc_txn_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(20) NOT NULL,
	"context" varchar(30) NOT NULL,
	"shop_id" varchar(50),
	"cashier_user_id" integer,
	"idempotency_key" varchar(64),
	"pos_ref" varchar(64),
	"edc_mode" varchar(10),
	"amount" numeric(10, 2),
	"response_code" varchar(10),
	"response_message" text,
	"approval_code" varchar(32),
	"has_approval_code" boolean NOT NULL,
	"masked_card" varchar(30),
	"rrn" varchar(64),
	"fields" jsonb,
	"checkout_attempted" boolean NOT NULL,
	"client_error" text,
	"client_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edc_txn_events" ADD CONSTRAINT "edc_txn_events_cashier_user_id_fkey" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_edc_txn_events_created_at" ON "edc_txn_events" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_edc_txn_events_shop" ON "edc_txn_events" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_edc_txn_events_idempotency_key" ON "edc_txn_events" USING btree ("idempotency_key" text_ops);--> statement-breakpoint
CREATE INDEX "ix_edc_txn_events_approval_code" ON "edc_txn_events" USING btree ("approval_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_edc_txn_events_unrecorded" ON "edc_txn_events" USING btree ("created_at" timestamptz_ops) WHERE ((response_code)::text = '00'::text AND checkout_attempted = false);