ALTER TABLE "shop_spending_groups" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "shop_spending_groups" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
