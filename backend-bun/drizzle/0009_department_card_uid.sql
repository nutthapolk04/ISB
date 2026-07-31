ALTER TABLE "departments" ADD COLUMN "card_uid" varchar(50);--> statement-breakpoint
CREATE INDEX "ix_departments_card_uid" ON "departments" USING btree ("card_uid" text_ops);