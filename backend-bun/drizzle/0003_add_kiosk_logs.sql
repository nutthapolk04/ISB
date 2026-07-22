CREATE TABLE "kiosk_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kiosk_user_id" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"level" varchar(10) NOT NULL,
	"category" varchar(20) NOT NULL,
	"message" varchar(500) NOT NULL,
	"data" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_logs" ADD CONSTRAINT "kiosk_logs_kiosk_user_id_fkey" FOREIGN KEY ("kiosk_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_kiosk_logs_kiosk_ts" ON "kiosk_logs" USING btree ("kiosk_user_id" int4_ops,"ts" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_kiosk_logs_ts" ON "kiosk_logs" USING btree ("ts" timestamptz_ops);