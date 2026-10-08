CREATE TYPE "public"."crm_connection_status" AS ENUM('ACTIVE', 'ERROR', 'DISCONNECTED', 'REAUTH_REQUIRED', 'SYNCING');--> statement-breakpoint
CREATE TYPE "public"."integration_health" AS ENUM('HEALTHY', 'DEGRADED', 'AUTH_ERROR', 'RATE_LIMITED', 'SYNC_ERROR');--> statement-breakpoint
CREATE TYPE "public"."sync_job_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."sync_job_type" AS ENUM('INITIAL', 'INCREMENTAL', 'WEBHOOK_RECONCILIATION', 'MANUAL');--> statement-breakpoint

CREATE TABLE "crm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"external_account_name" text NOT NULL,
	"status" "crm_connection_status" DEFAULT 'ACTIVE' NOT NULL,
	"health" "integration_health" DEFAULT 'HEALTHY' NOT NULL,
	"secret_reference" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_summary" text,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"deal_count" integer DEFAULT 0 NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"type" "sync_job_type" NOT NULL,
	"status" "sync_job_status" DEFAULT 'PENDING' NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contacts_fetched" integer DEFAULT 0 NOT NULL,
	"contacts_applied" integer DEFAULT 0 NOT NULL,
	"deals_fetched" integer DEFAULT 0 NOT NULL,
	"deals_applied" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_summary" text,
	"requested_by_user_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "crm_connections"
ADD CONSTRAINT "crm_connections_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "crm_connections"
ADD CONSTRAINT "crm_connections_connected_by_user_id_users_id_fk"
FOREIGN KEY ("connected_by_user_id")
REFERENCES "public"."users"("id")
ON DELETE set null
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "sync_jobs"
ADD CONSTRAINT "sync_jobs_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "sync_jobs"
ADD CONSTRAINT "sync_jobs_requested_by_user_id_users_id_fk"
FOREIGN KEY ("requested_by_user_id")
REFERENCES "public"."users"("id")
ON DELETE set null
ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "crm_connections_organization_id_uidx"
ON "crm_connections"
USING btree ("organization_id","id");
--> statement-breakpoint

ALTER TABLE "sync_jobs"
ADD CONSTRAINT "sync_jobs_organization_connection_fk"
FOREIGN KEY ("organization_id","connection_id")
REFERENCES "public"."crm_connections"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX "crm_connections_external_account_uidx"
ON "crm_connections"
USING btree ("organization_id","provider","external_account_id");
--> statement-breakpoint

CREATE INDEX "crm_connections_organization_status_idx"
ON "crm_connections"
USING btree ("organization_id","status");
--> statement-breakpoint

CREATE UNIQUE INDEX "sync_jobs_organization_id_uidx"
ON "sync_jobs"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE UNIQUE INDEX "sync_jobs_one_active_per_connection_uidx"
ON "sync_jobs"
USING btree ("organization_id","connection_id")
WHERE "sync_jobs"."status" in ('PENDING', 'RUNNING');
--> statement-breakpoint

CREATE INDEX "sync_jobs_organization_created_idx"
ON "sync_jobs"
USING btree ("organization_id","connection_id","created_at");
--> statement-breakpoint

ALTER TABLE "external_entity_identities"
ADD CONSTRAINT "external_identities_organization_connection_fk"
FOREIGN KEY ("organization_id","connection_id")
REFERENCES "public"."crm_connections"("organization_id","id")
ON DELETE SET NULL ("connection_id")
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "source_records"
ADD CONSTRAINT "source_records_organization_connection_fk"
FOREIGN KEY ("organization_id","connection_id")
REFERENCES "public"."crm_connections"("organization_id","id")
ON DELETE SET NULL ("connection_id")
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "source_records"
ADD CONSTRAINT "source_records_organization_sync_job_fk"
FOREIGN KEY ("organization_id","sync_job_id")
REFERENCES "public"."sync_jobs"("organization_id","id")
ON DELETE SET NULL ("sync_job_id")
ON UPDATE no action;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "crm_connections", "sync_jobs"
TO morubi_app;
--> statement-breakpoint

ALTER TABLE "crm_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "crm_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "sync_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "crm_connections_tenant_policy"
ON "crm_connections"
FOR ALL
TO morubi_app
USING (
	"organization_id" = NULLIF(
		current_setting('app.current_organization_id', true),
		''
	)::uuid
)
WITH CHECK (
	"organization_id" = NULLIF(
		current_setting('app.current_organization_id', true),
		''
	)::uuid
);
--> statement-breakpoint

CREATE POLICY "sync_jobs_tenant_policy"
ON "sync_jobs"
FOR ALL
TO morubi_app
USING (
	"organization_id" = NULLIF(
		current_setting('app.current_organization_id', true),
		''
	)::uuid
)
WITH CHECK (
	"organization_id" = NULLIF(
		current_setting('app.current_organization_id', true),
		''
	)::uuid
);