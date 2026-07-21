DROP INDEX "ix_customers_external_id";--> statement-breakpoint
DROP INDEX "ix_users_external_id";--> statement-breakpoint
CREATE UNIQUE INDEX "ix_customers_external_id" ON "customers" USING btree ("external_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_external_id" ON "users" USING btree ("external_id" text_ops);