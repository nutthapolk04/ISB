ALTER TABLE price_panel_items ADD COLUMN sort_order integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_price_panel_items_sort" ON "price_panel_items" ("panel_id" ASC,"sort_order" ASC);
