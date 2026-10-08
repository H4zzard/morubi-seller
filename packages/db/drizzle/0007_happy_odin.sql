CREATE TYPE "public"."audio_asset_status" AS ENUM('CREATED', 'FETCHING', 'READY', 'TRANSCRIBING', 'TRANSCRIBED', 'FAILED', 'EXPIRED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."commercial_content_origin" AS ENUM('TEXT', 'AUDIO_TRANSCRIPT', 'CALL_TRANSCRIPT', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('CURRENT', 'SUPERSEDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."transcription_job_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"idempotency_key" text NOT NULL,
	"source_provider" text NOT NULL,
	"source_url" text,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_file_name" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"sha256" text NOT NULL,
	"speaker_type" "message_sender_type" NOT NULL,
	"status" "audio_asset_status" DEFAULT 'READY' NOT NULL,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_assets_limits_check" CHECK ("audio_assets"."size_bytes" > 0 and "audio_assets"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_organization_id_uidx" ON "audio_assets" USING btree ("organization_id","id");--> statement-breakpoint
CREATE TABLE "audio_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audio_asset_id" uuid NOT NULL,
	"transcription_job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "transcript_status" DEFAULT 'CURRENT' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"text" text NOT NULL,
	"language" text,
	"confidence" real,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_duration_ms" integer NOT NULL,
	"usage_measurement" text NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_transcripts_values_check" CHECK ("audio_transcripts"."version" > 0 and length(trim("audio_transcripts"."text")) > 0 and "audio_transcripts"."audio_duration_ms" > 0 and ("audio_transcripts"."confidence" is null or "audio_transcripts"."confidence" between 0 and 1))
);
--> statement-breakpoint
CREATE TABLE "transcription_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audio_asset_id" uuid NOT NULL,
	"processing_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "transcription_job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcription_jobs_attempts_check" CHECK ("transcription_jobs"."attempts" >= 0 and "transcription_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_jobs_organization_id_uidx" ON "transcription_jobs" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "intelligence_settings" DROP CONSTRAINT "intelligence_settings_card_limits_check";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "audio_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "audio_transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "audio_duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "usage_measurement" text DEFAULT 'ACTUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD COLUMN "audio_transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD COLUMN "content_origin" "commercial_content_origin" DEFAULT 'TEXT' NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "audio_intelligence_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "audio_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "transcript_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "max_audio_bytes" integer DEFAULT 20971520 NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_organization_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_organization_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_organization_asset_fk" FOREIGN KEY ("organization_id","audio_asset_id") REFERENCES "public"."audio_assets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_organization_job_fk" FOREIGN KEY ("organization_id","transcription_job_id") REFERENCES "public"."transcription_jobs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_organization_asset_fk" FOREIGN KEY ("organization_id","audio_asset_id") REFERENCES "public"."audio_assets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_idempotency_uidx" ON "audio_assets" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_message_uidx" ON "audio_assets" USING btree ("organization_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_storage_key_uidx" ON "audio_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "audio_assets_retention_idx" ON "audio_assets" USING btree ("status","retention_until");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_transcripts_organization_id_uidx" ON "audio_transcripts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_transcripts_asset_version_uidx" ON "audio_transcripts" USING btree ("organization_id","audio_asset_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_transcripts_job_uidx" ON "audio_transcripts" USING btree ("organization_id","transcription_job_id");--> statement-breakpoint
CREATE INDEX "audio_transcripts_current_idx" ON "audio_transcripts" USING btree ("organization_id","audio_asset_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_transcripts_one_current_uidx" ON "audio_transcripts" ("organization_id", "audio_asset_id") WHERE "status" = 'CURRENT';--> statement-breakpoint
CREATE UNIQUE INDEX "transcription_jobs_processing_key_uidx" ON "transcription_jobs" USING btree ("organization_id","processing_key");--> statement-breakpoint
CREATE INDEX "transcription_jobs_claim_idx" ON "transcription_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_audio_asset_fk" FOREIGN KEY ("organization_id","audio_asset_id") REFERENCES "public"."audio_assets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_audio_transcript_fk" FOREIGN KEY ("organization_id","audio_transcript_id") REFERENCES "public"."audio_transcripts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_audio_transcript_fk" FOREIGN KEY ("organization_id","audio_transcript_id") REFERENCES "public"."audio_transcripts"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_transcription_uidx" ON "ai_usage" ("organization_id", "audio_transcript_id");--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD CONSTRAINT "intelligence_settings_card_limits_check" CHECK ("intelligence_settings"."max_cards_per_window" > 0 and "intelligence_settings"."card_window_seconds" >= 30 and "intelligence_settings"."cooldown_seconds" >= 0 and "intelligence_settings"."minimum_priority" between 0 and 100 and "intelligence_settings"."delivery_ttl_seconds" >= 30 and "intelligence_settings"."max_generation_input_characters" between 500 and 20000 and "intelligence_settings"."max_generation_output_characters" between 100 and 2000 and "intelligence_settings"."organization_generation_budget_micros" >= 0 and "intelligence_settings"."seller_generation_budget_micros" >= 0 and "intelligence_settings"."max_cost_per_intervention_micros" >= 0 and "intelligence_settings"."audio_retention_days" between 1 and 3650 and "intelligence_settings"."transcript_retention_days" between 1 and 3650 and "intelligence_settings"."max_audio_bytes" between 1024 and 104857600);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "audio_assets", "audio_transcripts", "transcription_jobs" TO morubi_app;
--> statement-breakpoint
ALTER TABLE "audio_assets" ENABLE ROW LEVEL SECURITY; ALTER TABLE "audio_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ENABLE ROW LEVEL SECURITY; ALTER TABLE "audio_transcripts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transcription_jobs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "transcription_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audio_assets_tenant_policy" ON "audio_assets" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "audio_transcripts_tenant_policy" ON "audio_transcripts" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "transcription_jobs_tenant_policy" ON "transcription_jobs" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
