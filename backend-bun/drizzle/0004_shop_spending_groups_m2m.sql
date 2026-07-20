CREATE TABLE "shop_spending_groups" (
	"shop_id" varchar(50) NOT NULL,
	"spending_group_id" integer NOT NULL,
	CONSTRAINT "shop_spending_groups_pkey" PRIMARY KEY("shop_id","spending_group_id"),
	CONSTRAINT "shop_spending_groups_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade,
	CONSTRAINT "shop_spending_groups_spending_group_id_fkey" FOREIGN KEY ("spending_group_id") REFERENCES "public"."spending_groups"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "ix_shop_spending_groups_group" ON "shop_spending_groups" USING btree ("spending_group_id");
--> statement-breakpoint
ALTER TABLE "spending_groups" ADD COLUMN "grades" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
INSERT INTO "shop_spending_groups" ("shop_id", "spending_group_id")
SELECT "id", "spending_group_id" FROM "shops" WHERE "spending_group_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT "shops_spending_group_id_fkey";
--> statement-breakpoint
DROP INDEX "ix_shops_spending_group";
--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "spending_group_id";
