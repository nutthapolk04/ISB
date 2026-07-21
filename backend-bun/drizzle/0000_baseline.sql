CREATE TYPE "public"."approvalrequesttype" AS ENUM('BUDGET_OVERRIDE', 'DISCOUNT', 'RETURN', 'VOID', 'PRICE_OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."approvalstatus" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."auditaction" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'RETURN', 'EXCHANGE', 'CANCEL', 'VOID', 'REPRINT', 'APPROVE', 'REJECT');--> statement-breakpoint
CREATE TYPE "public"."budgettransactiontype" AS ENUM('ALLOCATION', 'DEDUCTION', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."creditnotestatus" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."customertypeenum" AS ENUM('PUBLIC', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."movementtype" AS ENUM('receive', 'sale', 'adjustment', 'internal_use', 'void', 'exchange');--> statement-breakpoint
CREATE TYPE "public"."optionselectiontype" AS ENUM('single', 'multi', 'quantity');--> statement-breakpoint
CREATE TYPE "public"."paymentintentstatus" AS ENUM('pending', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."paymentmethod" AS ENUM('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET', 'BANK_TRANSFER', 'CARD_TAP', 'EDC', 'DEPARTMENT', 'OTHER', 'QR_PROMPTPAY');--> statement-breakpoint
CREATE TYPE "public"."receiptstatus" AS ENUM('ACTIVE', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."refundtype" AS ENUM('PRODUCT', 'WALLET', 'CASH');--> statement-breakpoint
CREATE TYPE "public"."returnstatus" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."shoptype" AS ENUM('avg_cost', 'fifo');--> statement-breakpoint
CREATE TYPE "public"."transactionmode" AS ENUM('SALE', 'INTERNAL_ISSUE');--> statement-breakpoint
CREATE TYPE "public"."transactiontype" AS ENUM('SALE', 'RETURN', 'ADJUSTMENT', 'INTERNAL_ISSUE', 'INITIAL');--> statement-breakpoint
CREATE TYPE "public"."wallettransactiontype" AS ENUM('TOPUP', 'DEDUCTION', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "alembic_version" (
	"version_num" varchar(32) PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_type" "approvalrequesttype" NOT NULL,
	"requested_by" integer NOT NULL,
	"request_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "approvalstatus" NOT NULL,
	"amount" numeric(10, 2),
	"reason" text,
	"reference_type" varchar(50),
	"reference_id" integer,
	"approved_by" integer,
	"approval_date" timestamp with time zone,
	"approval_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer,
	"action" "auditaction" NOT NULL,
	"user_id" integer NOT NULL,
	"changes_json" json,
	"ip_address" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" json,
	"shop_id" varchar(50),
	"entity_name" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "barcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"barcode" varchar(100) NOT NULL,
	"product_variant_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "budget_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer NOT NULL,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"transaction_type" "budgettransactiontype" NOT NULL,
	"reference_type" varchar(50),
	"reference_id" integer,
	"description" varchar(500),
	"balance_before" numeric(12, 2) NOT NULL,
	"balance_after" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"bundle_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"parent_id" integer,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "categories_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"credit_note_number" varchar(50) NOT NULL,
	"original_receipt_id" integer,
	"credit_date" timestamp with time zone DEFAULT now() NOT NULL,
	"total_credit_amount" numeric(10, 2) NOT NULL,
	"refund_type" "refundtype" NOT NULL,
	"status" "creditnotestatus" NOT NULL,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" integer
);
--> statement-breakpoint
CREATE TABLE "customer_display_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"content_type" varchar(50) NOT NULL,
	"filename" varchar(200),
	"size_bytes" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" integer
);
--> statement-breakpoint
CREATE TABLE "customer_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"type_name" "customertypeenum" NOT NULL,
	"description" varchar(255),
	"default_price_level" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_types_type_name_key" UNIQUE("type_name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"photo_url" varchar(500),
	"customer_type_id" integer NOT NULL,
	"department_id" integer,
	"email" varchar(255),
	"phone" varchar(20),
	"is_active" boolean NOT NULL,
	"student_code" varchar(20),
	"grade" varchar(20),
	"allergies" text,
	"dietary_notes" text,
	"card_uid" varchar(50),
	"card_frozen" boolean NOT NULL,
	"daily_limit" numeric(10, 2),
	"negative_credit_limit" numeric(10, 2),
	"allergy_override_note" text,
	"powerschool_sync_at" timestamp with time zone,
	"family_code" varchar(20),
	"external_id" varchar(50),
	"customer_type" varchar(20),
	"school_type" varchar(20),
	"customer_kind" varchar(20) DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"is_graduated" boolean DEFAULT false NOT NULL,
	"enroll_date" date,
	"withdraw_date" date,
	"daily_limit_canteen" numeric(10, 2),
	"daily_limit_store" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_code" varchar(50) NOT NULL,
	"department_name" varchar(255) NOT NULL,
	"annual_budget" numeric(12, 2) NOT NULL,
	"current_year" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_alerts_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" varchar(40) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"parent_user_id" integer,
	"child_customer_id" integer,
	"subject" varchar(500) NOT NULL,
	"threshold_amount" numeric(10, 2),
	"balance_at_alert" numeric(10, 2),
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_profiles" (
	"family_code" varchar(20) PRIMARY KEY NOT NULL,
	"notification_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"login_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fifo_lots" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"qty_remaining" numeric(10, 4) NOT NULL,
	"cost_per_unit" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"old_external_id" varchar(50),
	"new_external_id" varchar(50),
	"reason" varchar(200),
	"changed_by" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_type" "transactiontype" NOT NULL,
	"product_variant_id" integer NOT NULL,
	"quantity_change" integer NOT NULL,
	"reference_type" varchar(50),
	"reference_id" integer,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_option_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"selection_type" "optionselectiontype" NOT NULL,
	"is_required" boolean NOT NULL,
	"max_selections" integer,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "menu_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"option_group_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"price_delta" numeric(10, 2) NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parent_child_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_user_id" integer NOT NULL,
	"child_customer_id" integer NOT NULL,
	"relation" varchar(20) NOT NULL,
	"parent_rank" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"low_balance_threshold" numeric(10, 2),
	"low_balance_alert_enabled" boolean DEFAULT false NOT NULL,
	"last_low_balance_alert_at" timestamp with time zone,
	CONSTRAINT "uq_parent_child" UNIQUE("child_customer_id","parent_user_id")
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref_code" varchar(50) NOT NULL,
	"wallet_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"qr_payload" text,
	"status" "paymentintentstatus" NOT NULL,
	"payment_method" varchar(30) NOT NULL,
	"confirmed_via" varchar(30),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" integer,
	"notes" varchar(500),
	"txn_no" varchar(100),
	"intent_type" varchar(20) DEFAULT 'wallet_topup',
	"cart_snapshot" jsonb,
	"receipt_id" integer,
	"acting_user_id" integer,
	"acting_customer_id" integer
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"resource" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "price_panel_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"panel_id" integer NOT NULL,
	"product_id" integer,
	"price" numeric(10, 2),
	"updated_at" timestamp with time zone DEFAULT now(),
	"short_name" varchar(100),
	"included" boolean DEFAULT true NOT NULL,
	"bundle_id" integer,
	CONSTRAINT "uq_panel_product" UNIQUE("panel_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "price_panels" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(50),
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"barcode" varchar(100) NOT NULL,
	"label" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_barcodes_barcode_key" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "product_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"bundle_code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"external_price" numeric(10, 2) NOT NULL,
	"internal_price" numeric(10, 2) NOT NULL,
	"photo_url" varchar(500),
	"color" varchar(50),
	"sort_order" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"barcode" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "product_order_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"version" integer NOT NULL,
	"sort_map" json NOT NULL,
	"changed_by" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sku" varchar(100) NOT NULL,
	"variant_name" varchar(255) NOT NULL,
	"color" varchar(50),
	"size" varchar(50),
	"barcode" varchar(100),
	"cost_price" numeric(10, 2) NOT NULL,
	"retail_price" numeric(10, 2) NOT NULL,
	"image_url" varchar(500),
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category_id" integer NOT NULL,
	"brand" varchar(100),
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" integer NOT NULL,
	"product_variant_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"price_override" numeric(10, 2),
	"discount" numeric(10, 2) NOT NULL,
	"line_total" numeric(10, 2) NOT NULL,
	"options" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_number" varchar(50) NOT NULL,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_mode" "transactionmode" NOT NULL,
	"customer_type_id" integer,
	"customer_id" integer,
	"payer_user_id" integer,
	"payer_department_id" integer,
	"requester_user_id" integer,
	"shop_id" varchar(50),
	"subtotal" numeric(10, 2) NOT NULL,
	"discount" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"payment_method" "paymentmethod" NOT NULL,
	"status" "receiptstatus" NOT NULL,
	"terminal_id" varchar(50),
	"notes" text,
	"edc_terminal_ref" varchar(50),
	"edc_approval_code" varchar(20),
	"edc_masked_card" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" integer,
	"voided_reason" varchar(500),
	"cash_received" numeric(10, 2),
	"spending_group_id" integer
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" varchar(50) NOT NULL,
	"product_code" varchar(50) NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"return_quantity" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"status" "returnstatus" NOT NULL,
	"price_type" varchar(20),
	"void_status" varchar(20),
	"return_status" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"refund_method" varchar(20),
	"exchange_product_codes" varchar(500),
	"refund_amount" numeric(10, 2),
	"exchange_amount" numeric(10, 2),
	"processed_at" timestamp with time zone,
	"bundle_id" integer
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("permission_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" varchar(255),
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "roles_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "shop_categories" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"product_id" integer,
	"product_name" varchar(255) NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"type" "movementtype" NOT NULL,
	"quantity" integer NOT NULL,
	"stock_before" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"cost_per_unit" numeric(10, 4),
	"reference" varchar(100),
	"note" varchar(500),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_id" integer,
	"reversed_by_id" integer,
	"sale_amount" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "shop_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"product_code" varchar(50) NOT NULL,
	"barcode" varchar(100),
	"name" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"external_price" numeric(10, 2) NOT NULL,
	"internal_price" numeric(10, 2) NOT NULL,
	"vat_percent" numeric(5, 2) NOT NULL,
	"avg_cost" numeric(10, 4) NOT NULL,
	"stock" integer NOT NULL,
	"min_stock" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"photo_url" varchar(500),
	"color" varchar(50),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"uom_id" integer,
	"short_name" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "shop_spending_groups" (
	"shop_id" varchar(50) NOT NULL,
	"spending_group_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_spending_groups_pkey" PRIMARY KEY("shop_id","spending_group_id")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"shop_type" "shoptype" NOT NULL,
	"description" varchar(500),
	"is_active" boolean NOT NULL,
	"allow_department_charge" boolean DEFAULT false NOT NULL,
	"module" varchar(20) DEFAULT 'store' NOT NULL,
	"uses_dual_pricing" boolean DEFAULT true NOT NULL,
	"products_order_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"receipt_header" varchar(500),
	"receipt_footer" varchar(500),
	"void_shortcuts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shop_number" integer
);
--> statement-breakpoint
CREATE TABLE "spending_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"name_en" varchar(100) NOT NULL,
	"name_th" varchar(100) NOT NULL,
	"daily_limit" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grades" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_variant_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"low_stock_threshold" integer NOT NULL,
	"location" varchar(100),
	"updated_at" timestamp with time zone DEFAULT now(),
	"updated_by" integer,
	CONSTRAINT "stock_levels_product_variant_id_key" UNIQUE("product_variant_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_variant_id" integer NOT NULL,
	"quantity_before" integer NOT NULL,
	"quantity_change" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"movement_type" "transactiontype" NOT NULL,
	"reference_document" varchar(100),
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_period_close_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"close_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"system_qty" integer NOT NULL,
	"physical_qty" integer,
	"variance_qty" integer,
	"unit_cost" numeric(10, 4),
	"variance_value" numeric(10, 4),
	"adjustment_movement_id" integer
);
--> statement-breakpoint
CREATE TABLE "stock_period_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"shop_id" varchar(50) NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"closed_by" integer,
	"closed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stock_period_closes_shop_period" UNIQUE("period_month","period_year","shop_id")
);
--> statement-breakpoint
CREATE TABLE "sync_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_log_id" integer NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_name" varchar(255),
	"external_id" varchar(50),
	"action" varchar(20) NOT NULL,
	"changes" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_type" varchar(20) NOT NULL,
	"target_roles" jsonb NOT NULL,
	"triggered_by" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(20) NOT NULL,
	"records_total" integer NOT NULL,
	"records_success" integer NOT NULL,
	"records_failed" integer NOT NULL,
	"error_log" text
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE "units_of_measure" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"base_uom_id" integer,
	"conversion_factor" numeric(10, 4) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_login_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_pkey" PRIMARY KEY("role_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"hashed_password" varchar(255) NOT NULL,
	"is_active" boolean NOT NULL,
	"is_superuser" boolean NOT NULL,
	"role" varchar(20) DEFAULT 'cashier',
	"terminal_id" varchar(50),
	"external_id" varchar(50),
	"family_code" varchar(20),
	"photo_url" varchar(500),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"allergies" text,
	"card_uid" varchar(50),
	"customer_type" varchar(20),
	"shop_id" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"department_id" integer,
	"shop_module" varchar(20),
	"session_token" varchar(64),
	"staff_type" varchar(30),
	"ps_department" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"transaction_type" "wallettransactiontype" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_before" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"reference_type" varchar(50),
	"reference_id" integer,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer NOT NULL,
	"reason" text,
	"reference_ticket" varchar(100),
	"refund_method" varchar(20),
	"acting_user_id" integer,
	"acting_customer_id" integer
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"user_id" integer,
	"department_id" integer,
	"balance" numeric(10, 2) NOT NULL,
	"is_active" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "wallets_customer_id_key" UNIQUE("customer_id"),
	CONSTRAINT "chk_wallet_owner" CHECK (((((customer_id IS NOT NULL))::integer + ((user_id IS NOT NULL))::integer) + ((department_id IS NOT NULL))::integer) = 1)
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "public"."product_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_receipt_id_fkey" FOREIGN KEY ("original_receipt_id") REFERENCES "public"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_display_images" ADD CONSTRAINT "customer_display_images_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_alerts_log" ADD CONSTRAINT "email_alerts_log_child_customer_id_fkey" FOREIGN KEY ("child_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_alerts_log" ADD CONSTRAINT "email_alerts_log_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fifo_lots" ADD CONSTRAINT "fifo_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fifo_lots" ADD CONSTRAINT "fifo_lots_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_mappings" ADD CONSTRAINT "identity_mappings_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_option_groups" ADD CONSTRAINT "menu_option_groups_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_options" ADD CONSTRAINT "menu_options_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "public"."menu_option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child_links" ADD CONSTRAINT "parent_child_links_child_customer_id_fkey" FOREIGN KEY ("child_customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_child_links" ADD CONSTRAINT "parent_child_links_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_acting_user_id_fkey" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_acting_customer_id_fkey" FOREIGN KEY ("acting_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_panel_items" ADD CONSTRAINT "price_panel_items_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "public"."product_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_panel_items" ADD CONSTRAINT "price_panel_items_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "public"."price_panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_panel_items" ADD CONSTRAINT "price_panel_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_panels" ADD CONSTRAINT "price_panels_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_order_history" ADD CONSTRAINT "product_order_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_order_history" ADD CONSTRAINT "product_order_history_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."shop_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_type_id_fkey" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payer_department_id_fkey" FOREIGN KEY ("payer_department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_spending_group_id_fkey" FOREIGN KEY ("spending_group_id") REFERENCES "public"."spending_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_categories" ADD CONSTRAINT "shop_categories_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_movements" ADD CONSTRAINT "shop_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_movements" ADD CONSTRAINT "shop_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_movements" ADD CONSTRAINT "shop_movements_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."shop_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_movements" ADD CONSTRAINT "shop_movements_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "public"."shop_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_movements" ADD CONSTRAINT "shop_movements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_products" ADD CONSTRAINT "shop_products_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "public"."units_of_measure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_spending_groups" ADD CONSTRAINT "shop_spending_groups_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_spending_groups" ADD CONSTRAINT "shop_spending_groups_spending_group_id_fkey" FOREIGN KEY ("spending_group_id") REFERENCES "public"."spending_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_period_close_items" ADD CONSTRAINT "stock_period_close_items_adjustment_movement_id_fkey" FOREIGN KEY ("adjustment_movement_id") REFERENCES "public"."shop_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_period_close_items" ADD CONSTRAINT "stock_period_close_items_close_id_fkey" FOREIGN KEY ("close_id") REFERENCES "public"."stock_period_closes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_period_close_items" ADD CONSTRAINT "stock_period_close_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."shop_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_period_closes" ADD CONSTRAINT "stock_period_closes_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_period_closes" ADD CONSTRAINT "stock_period_closes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_audit_logs" ADD CONSTRAINT "sync_audit_logs_sync_log_id_fkey" FOREIGN KEY ("sync_log_id") REFERENCES "public"."sync_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login_emails" ADD CONSTRAINT "user_login_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_acting_user_id_fkey" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_acting_customer_id_fkey" FOREIGN KEY ("acting_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_approval_requests_id" ON "approval_requests" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_created" ON "audit_logs" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_created_at" ON "audit_logs" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_entity" ON "audit_logs" USING btree ("entity_type" text_ops,"entity_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_entity_id" ON "audit_logs" USING btree ("entity_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_entity_type" ON "audit_logs" USING btree ("entity_type" text_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_id" ON "audit_logs" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_audit_logs_shop" ON "audit_logs" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_barcodes_barcode" ON "barcodes" USING btree ("barcode" text_ops);--> statement-breakpoint
CREATE INDEX "ix_barcodes_id" ON "barcodes" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_budget_transactions_id" ON "budget_transactions" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_bundle_items_bundle" ON "bundle_items" USING btree ("bundle_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_bundle_items_bundle_id" ON "bundle_items" USING btree ("bundle_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_bundle_items_product" ON "bundle_items" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_bundle_items_product_id" ON "bundle_items" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_categories_id" ON "categories" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_credit_notes_credit_note_number" ON "credit_notes" USING btree ("credit_note_number" text_ops);--> statement-breakpoint
CREATE INDEX "ix_credit_notes_id" ON "credit_notes" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_customer_display_images_sort" ON "customer_display_images" USING btree ("sort_order" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_customer_types_id" ON "customer_types" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_customers_card_uid" ON "customers" USING btree ("card_uid" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_customers_customer_code" ON "customers" USING btree ("customer_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_customers_customer_kind" ON "customers" USING btree ("customer_kind" text_ops);--> statement-breakpoint
CREATE INDEX "ix_customers_external_id" ON "customers" USING btree ("external_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_customers_family_code" ON "customers" USING btree ("family_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_customers_id" ON "customers" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_customers_kind" ON "customers" USING btree ("customer_kind" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_customers_student_code" ON "customers" USING btree ("student_code" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_departments_department_code" ON "departments" USING btree ("department_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_departments_id" ON "departments" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_email_alerts_log_alert_type" ON "email_alerts_log" USING btree ("alert_type" text_ops);--> statement-breakpoint
CREATE INDEX "ix_email_alerts_log_id" ON "email_alerts_log" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_email_alerts_log_sent_at" ON "email_alerts_log" USING btree ("sent_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_fifo_lots_product_id" ON "fifo_lots" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_fifo_lots_shop_id" ON "fifo_lots" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_identity_mappings_entity" ON "identity_mappings" USING btree ("entity_type" text_ops,"entity_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_identity_mappings_id" ON "identity_mappings" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_inventory_transactions_id" ON "inventory_transactions" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_menu_option_groups_product" ON "menu_option_groups" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_menu_option_groups_product_id" ON "menu_option_groups" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_menu_options_group" ON "menu_options" USING btree ("option_group_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_menu_options_option_group_id" ON "menu_options" USING btree ("option_group_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_parent_child_child" ON "parent_child_links" USING btree ("child_customer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_parent_child_links_child_customer_id" ON "parent_child_links" USING btree ("child_customer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_parent_child_links_id" ON "parent_child_links" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_parent_child_links_parent_user_id" ON "parent_child_links" USING btree ("parent_user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_parent_child_parent" ON "parent_child_links" USING btree ("parent_user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_id" ON "payment_intents" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_intent_type" ON "payment_intents" USING btree ("intent_type" text_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_ref" ON "payment_intents" USING btree ("ref_code" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_payment_intents_ref_code" ON "payment_intents" USING btree ("ref_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_txn_no" ON "payment_intents" USING btree ("txn_no" text_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_wallet" ON "payment_intents" USING btree ("wallet_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_payment_intents_wallet_id" ON "payment_intents" USING btree ("wallet_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_permissions_id" ON "permissions" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_price_panel_items_bundle_id" ON "price_panel_items" USING btree ("bundle_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_price_panel_items_panel_id" ON "price_panel_items" USING btree ("panel_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_price_panel_items_product_id" ON "price_panel_items" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_price_panels_shop_id" ON "price_panels" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_barcodes_product" ON "product_barcodes" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_product_barcodes_product_id" ON "product_barcodes" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_product_bundles_barcode" ON "product_bundles" USING btree ("barcode" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_bundles_bundle_code" ON "product_bundles" USING btree ("bundle_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_bundles_code" ON "product_bundles" USING btree ("bundle_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_bundles_shop" ON "product_bundles" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_bundles_shop_id" ON "product_bundles" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_order_history_shop" ON "product_order_history" USING btree ("shop_id" text_ops,"version" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_product_order_history_shop_id" ON "product_order_history" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_product_variants_barcode" ON "product_variants" USING btree ("barcode" text_ops);--> statement-breakpoint
CREATE INDEX "ix_product_variants_id" ON "product_variants" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_product_variants_sku" ON "product_variants" USING btree ("sku" text_ops);--> statement-breakpoint
CREATE INDEX "ix_products_id" ON "products" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_products_name" ON "products" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "ix_receipt_items_id" ON "receipt_items" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_id" ON "receipts" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_payer_department_id" ON "receipts" USING btree ("payer_department_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_payer_dept" ON "receipts" USING btree ("payer_department_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_payer_shop_date" ON "receipts" USING btree ("payer_user_id" int4_ops,"customer_id" int4_ops,"payer_department_id" int4_ops,"spending_group_id" int4_ops,"transaction_date" timestamptz_ops) WHERE (status = 'ACTIVE'::receiptstatus);--> statement-breakpoint
CREATE INDEX "ix_receipts_payer_user" ON "receipts" USING btree ("payer_user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_payer_user_id" ON "receipts" USING btree ("payer_user_id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_receipts_receipt_number" ON "receipts" USING btree ("receipt_number" text_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_requester_user_id" ON "receipts" USING btree ("requester_user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_shop" ON "receipts" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_receipts_shop_id" ON "receipts" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_return_requests_bundle_id" ON "return_requests" USING btree ("bundle_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_return_requests_id" ON "return_requests" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_return_requests_receipt_id" ON "return_requests" USING btree ("receipt_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_roles_id" ON "roles" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shop_categories_shop_name" ON "shop_categories" USING btree ("shop_id" text_ops,"name" text_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_movements_date" ON "shop_movements" USING btree ("date" date_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_movements_product_id" ON "shop_movements" USING btree ("product_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_movements_shop_id" ON "shop_movements" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_products_barcode" ON "shop_products" USING btree ("barcode" text_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_products_name" ON "shop_products" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_products_shop_id" ON "shop_products" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_products_sort" ON "shop_products" USING btree ("shop_id" text_ops,"sort_order" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_shop_spending_groups_group" ON "shop_spending_groups" USING btree ("spending_group_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_spending_groups_active" ON "spending_groups" USING btree ("is_active" bool_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_spending_groups_code" ON "spending_groups" USING btree ("code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_stock_levels_id" ON "stock_levels" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_stock_movements_id" ON "stock_movements" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_stock_period_close_items_close_id" ON "stock_period_close_items" USING btree ("close_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_stock_period_closes_shop_id" ON "stock_period_closes" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_audit_entity" ON "sync_audit_logs" USING btree ("entity_type" text_ops,"entity_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_audit_log_id" ON "sync_audit_logs" USING btree ("sync_log_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_audit_logs_id" ON "sync_audit_logs" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_audit_logs_sync_log_id" ON "sync_audit_logs" USING btree ("sync_log_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_logs_id" ON "sync_logs" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_sync_logs_started" ON "sync_logs" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "ix_system_settings_id" ON "system_settings" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_system_settings_key" ON "system_settings" USING btree ("key" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_units_of_measure_code" ON "units_of_measure" USING btree ("code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_uom_code" ON "units_of_measure" USING btree ("code" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_user_login_emails_email" ON "user_login_emails" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "ix_user_login_emails_user_id" ON "user_login_emails" USING btree ("user_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_users_card_uid" ON "users" USING btree ("card_uid" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_email" ON "users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "ix_users_external_id" ON "users" USING btree ("external_id" text_ops);--> statement-breakpoint
CREATE INDEX "ix_users_family_code" ON "users" USING btree ("family_code" text_ops);--> statement-breakpoint
CREATE INDEX "ix_users_id" ON "users" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_users_shop_id" ON "users" USING btree ("shop_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_username" ON "users" USING btree ("username" text_ops);--> statement-breakpoint
CREATE INDEX "ix_wallet_transactions_id" ON "wallet_transactions" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_wallet_tx_cashier_idempotency" ON "wallet_transactions" USING btree ("reference_ticket" text_ops) WHERE ((reference_ticket)::text ~~ 'cashier-idem:%'::text);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_wallet_tx_vendor_idempotency" ON "wallet_transactions" USING btree ("reference_ticket" text_ops) WHERE ((reference_ticket)::text ~~ 'vendor-adjust:%'::text);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_wallets_department_id" ON "wallets" USING btree ("department_id" int4_ops);--> statement-breakpoint
CREATE INDEX "ix_wallets_id" ON "wallets" USING btree ("id" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ix_wallets_user_id" ON "wallets" USING btree ("user_id" int4_ops);