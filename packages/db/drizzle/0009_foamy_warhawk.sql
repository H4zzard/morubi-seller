CREATE TYPE "public"."call_report_revision_status" AS ENUM('CURRENT', 'SUPERSEDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."call_report_status" AS ENUM('PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."post_call_job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "call_report_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"call_report_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "call_report_revision_status" DEFAULT 'CURRENT' NOT NULL,
	"processing_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"profile" text DEFAULT 'POST_CALL_ANALYSIS' NOT NULL,
	"prompt_version" text NOT NULL,
	"config_version" text NOT NULL,
	"content" jsonb NOT NULL,
	"proposals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_report_revisions_values_check" CHECK ("call_report_revisions"."version" > 0 and "call_report_revisions"."input_tokens" >= 0 and "call_report_revisions"."output_tokens" >= 0 and "call_report_revisions"."estimated_cost_micros" >= 0 and "call_report_revisions"."evidence_count" > 0 and "call_report_revisions"."profile" = 'POST_CALL_ANALYSIS')
);
--> statement-breakpoint
CREATE TABLE "call_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"status" "call_report_status" DEFAULT 'PROCESSING' NOT NULL,
	"processing_version" text NOT NULL,
	"failure_code" text,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_call_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"processing_version" text NOT NULL,
	"status" "post_call_job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_call_jobs_attempts_check" CHECK ("post_call_jobs"."attempts" >= 0 and "post_call_jobs"."max_attempts" between 1 and 10 and "post_call_jobs"."priority" between 0 and 50)
);
--> statement-breakpoint
ALTER TABLE "realtime_events" DROP CONSTRAINT "realtime_events_type_check";--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "commercial_event_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "call_report_revision_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "call_reports_organization_id_uidx" ON "call_reports" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD CONSTRAINT "call_report_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD CONSTRAINT "call_report_revisions_organization_report_fk" FOREIGN KEY ("organization_id","call_report_id") REFERENCES "public"."call_reports"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD CONSTRAINT "call_report_revisions_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_reports" ADD CONSTRAINT "call_reports_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_call_jobs" ADD CONSTRAINT "post_call_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_call_jobs" ADD CONSTRAINT "post_call_jobs_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_report_revisions_organization_id_uidx" ON "call_report_revisions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_report_revisions_version_uidx" ON "call_report_revisions" USING btree ("organization_id","call_report_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "call_report_revisions_current_uidx" ON "call_report_revisions" USING btree ("organization_id","call_report_id") WHERE "call_report_revisions"."status" = 'CURRENT';--> statement-breakpoint
CREATE UNIQUE INDEX "call_reports_session_uidx" ON "call_reports" USING btree ("organization_id","live_call_session_id");--> statement-breakpoint
CREATE INDEX "call_reports_status_idx" ON "call_reports" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_call_jobs_organization_id_uidx" ON "post_call_jobs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_call_jobs_processing_uidx" ON "post_call_jobs" USING btree ("organization_id","live_call_session_id","processing_version");--> statement-breakpoint
CREATE INDEX "post_call_jobs_claim_idx" ON "post_call_jobs" USING btree ("status","priority","available_at","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_call_report_revision_fk" FOREIGN KEY ("organization_id","call_report_revision_id") REFERENCES "public"."call_report_revisions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_call_report_revision_uidx" ON "ai_usage" USING btree ("organization_id","call_report_revision_id");--> statement-breakpoint
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_type_check" CHECK ("realtime_events"."type" in ('intervention.created', 'intervention.updated', 'deal_state.updated', 'call_report.processing', 'call_report.ready', 'call_report.failed'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "post_call_jobs", "call_reports", "call_report_revisions" TO morubi_app;
--> statement-breakpoint
ALTER TABLE "post_call_jobs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "post_call_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_reports" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_reports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_report_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "post_call_jobs_tenant_policy" ON "post_call_jobs" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_reports_tenant_policy" ON "call_reports" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_report_revisions_tenant_policy" ON "call_report_revisions" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
