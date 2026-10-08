ALTER TYPE "public"."call_report_status" ADD VALUE IF NOT EXISTS 'STALE';
--> statement-breakpoint
ALTER TABLE "post_call_jobs" ADD COLUMN "transcript_version" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_reports" ADD COLUMN "transcript_version" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "transcript_version" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "summary" text;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "outcome" text;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "confidence" real;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "duration_seconds" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "participant_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "topic_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "objection_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "action_item_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "seller_score_average" real;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "deal_stage" text;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD COLUMN "purchase_intent" text;
--> statement-breakpoint
UPDATE "call_report_revisions"
SET
  "summary" = COALESCE("content" #>> '{executiveSummary,value}', 'Legacy post-call report'),
  "outcome" = COALESCE("content" #>> '{assessment,outcome}', 'INCONCLUSIVE'),
  "confidence" = COALESCE(("content" #>> '{assessment,confidence}')::real, 0),
  "purchase_intent" = COALESCE("content" #>> '{dealAssessment,purchaseIntent}', 'UNKNOWN')
WHERE "summary" IS NULL OR "outcome" IS NULL OR "confidence" IS NULL OR "purchase_intent" IS NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ALTER COLUMN "summary" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ALTER COLUMN "outcome" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ALTER COLUMN "confidence" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ALTER COLUMN "purchase_intent" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "post_call_jobs" ALTER COLUMN "transcript_version" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "call_reports" ALTER COLUMN "transcript_version" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ALTER COLUMN "transcript_version" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "post_call_jobs" DROP CONSTRAINT "post_call_jobs_attempts_check";
--> statement-breakpoint
ALTER TABLE "call_report_revisions" DROP CONSTRAINT "call_report_revisions_values_check";
--> statement-breakpoint
ALTER TABLE "post_call_jobs" ADD CONSTRAINT "post_call_jobs_attempts_check" CHECK ("attempts" >= 0 and "max_attempts" between 1 and 10 and "priority" between 0 and 50);
--> statement-breakpoint
ALTER TABLE "call_report_revisions" ADD CONSTRAINT "call_report_revisions_values_check" CHECK ("version" > 0 and "input_tokens" >= 0 and "output_tokens" >= 0 and "estimated_cost_micros" >= 0 and "evidence_count" > 0 and "duration_seconds" >= 0 and "participant_count" >= 0 and "topic_count" >= 0 and "objection_count" >= 0 and "action_item_count" >= 0 and "confidence" between 0 and 1 and "profile" = 'POST_CALL_ANALYSIS');
--> statement-breakpoint
DROP INDEX "post_call_jobs_processing_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "post_call_jobs_processing_uidx" ON "post_call_jobs" USING btree ("organization_id", "live_call_session_id", "transcript_version", "processing_version");
--> statement-breakpoint
CREATE INDEX "call_report_revisions_analytics_idx" ON "call_report_revisions" USING btree ("organization_id", "outcome", "purchase_intent", "generated_at");
--> statement-breakpoint
CREATE TABLE "call_report_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "call_report_revision_id" uuid NOT NULL,
  "live_transcript_turn_id" uuid NOT NULL,
  "timestamp" timestamp with time zone NOT NULL,
  "speaker_role" text NOT NULL,
  "participant_role" text NOT NULL,
  "excerpt" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_report_action_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "call_report_revision_id" uuid NOT NULL,
  "description" text NOT NULL,
  "owner_role" text,
  "owner_name" text,
  "due_at" timestamp with time zone,
  "source" text NOT NULL,
  "confidence" real NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "evidence_turn_ids" uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "call_report_action_items_values_check" CHECK ("confidence" between 0 and 1 and "source" in ('EXPLICIT', 'IMPLICIT') and "status" = 'OPEN')
);
--> statement-breakpoint
CREATE TABLE "call_report_seller_performance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "call_report_revision_id" uuid NOT NULL,
  "dimension" text NOT NULL,
  "rating" text NOT NULL,
  "score" real,
  "confidence" real NOT NULL,
  "rationale" text NOT NULL,
  "evidence_turn_ids" uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "call_report_seller_performance_values_check" CHECK ("confidence" between 0 and 1 and ("score" is null or "score" between 0 and 100))
);
--> statement-breakpoint
ALTER TABLE "call_report_evidence" ADD CONSTRAINT "call_report_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_evidence" ADD CONSTRAINT "call_report_evidence_organization_revision_fk" FOREIGN KEY ("organization_id", "call_report_revision_id") REFERENCES "public"."call_report_revisions"("organization_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_evidence" ADD CONSTRAINT "call_report_evidence_organization_turn_fk" FOREIGN KEY ("organization_id", "live_transcript_turn_id") REFERENCES "public"."live_transcript_turns"("organization_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_action_items" ADD CONSTRAINT "call_report_action_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_action_items" ADD CONSTRAINT "call_report_action_items_organization_revision_fk" FOREIGN KEY ("organization_id", "call_report_revision_id") REFERENCES "public"."call_report_revisions"("organization_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_seller_performance" ADD CONSTRAINT "call_report_seller_performance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "call_report_seller_performance" ADD CONSTRAINT "call_report_seller_performance_organization_revision_fk" FOREIGN KEY ("organization_id", "call_report_revision_id") REFERENCES "public"."call_report_revisions"("organization_id", "id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "call_report_evidence_turn_uidx" ON "call_report_evidence" USING btree ("organization_id", "call_report_revision_id", "live_transcript_turn_id");
--> statement-breakpoint
CREATE INDEX "call_report_evidence_revision_idx" ON "call_report_evidence" USING btree ("organization_id", "call_report_revision_id");
--> statement-breakpoint
CREATE INDEX "call_report_action_items_revision_idx" ON "call_report_action_items" USING btree ("organization_id", "call_report_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "call_report_seller_performance_dimension_uidx" ON "call_report_seller_performance" USING btree ("organization_id", "call_report_revision_id", "dimension");
--> statement-breakpoint
CREATE INDEX "call_report_seller_performance_analytics_idx" ON "call_report_seller_performance" USING btree ("organization_id", "dimension", "rating", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "call_report_evidence", "call_report_action_items", "call_report_seller_performance" TO morubi_app;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "call_report_evidence", "call_report_action_items", "call_report_seller_performance" FROM morubi_auth;
--> statement-breakpoint
ALTER TABLE "call_report_evidence" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_report_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_report_action_items" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_report_action_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_report_seller_performance" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_report_seller_performance" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "call_report_evidence_tenant_policy" ON "call_report_evidence" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_report_action_items_tenant_policy" ON "call_report_action_items" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_report_seller_performance_tenant_policy" ON "call_report_seller_performance" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
