CREATE TABLE "kiosk_custodians" (
	"id" serial PRIMARY KEY NOT NULL,
	"kiosk_user_id" integer NOT NULL,
	"custodian_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kiosk_last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kiosk_status" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kiosk_offline_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kiosk_custodians" ADD CONSTRAINT "kiosk_custodians_kiosk_user_id_fkey" FOREIGN KEY ("kiosk_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_custodians" ADD CONSTRAINT "kiosk_custodians_custodian_user_id_fkey" FOREIGN KEY ("custodian_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_kiosk_custodians_kiosk_user_id" ON "kiosk_custodians" USING btree ("kiosk_user_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_kiosk_custodians_pair" ON "kiosk_custodians" USING btree ("kiosk_user_id" int4_ops,"custodian_user_id" int4_ops);