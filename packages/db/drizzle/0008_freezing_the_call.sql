CREATE TYPE "public"."call_consent_mode" AS ENUM('MANUAL_CONFIRMATION', 'ORGANIZATION_POLICY');--> statement-breakpoint
CREATE TYPE "public"."call_phase" AS ENUM('INTRODUCTION', 'DISCOVERY', 'PRESENTATION', 'VALUE', 'DECISION', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."live_call_session_status" AS ENUM('DETECTED', 'READY', 'STARTING', 'ACTIVE', 'ENDING', 'ENDED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."live_capture_mode" AS ENUM('MICROPHONE', 'SYSTEM_AUDIO', 'MIXED', 'FIXTURE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."live_speaker_role" AS ENUM('SELLER', 'LEAD', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."live_transcription_mode" AS ENUM('REALTIME', 'FIXTURE');--> statement-breakpoint
CREATE TYPE "public"."meeting_provider" AS ENUM('MEET', 'ZOOM', 'TEAMS', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE "call_consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"consent_mode" "call_consent_mode" NOT NULL,
	"confirmed_by_membership_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"capture_sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"seller_membership_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"call_duration_seconds" integer DEFAULT 0 NOT NULL,
	"audio_processed_seconds" integer DEFAULT 0 NOT NULL,
	"transcription_input_units" integer DEFAULT 0 NOT NULL,
	"decision_count" integer DEFAULT 0 NOT NULL,
	"generation_count" integer DEFAULT 0 NOT NULL,
	"cards_delivered" integer DEFAULT 0 NOT NULL,
	"dropped_chunks" integer DEFAULT 0 NOT NULL,
	"cost_total_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_usage_nonnegative_check" CHECK ("call_usage"."call_duration_seconds" >= 0 and "call_usage"."audio_processed_seconds" >= 0 and "call_usage"."transcription_input_units" >= 0 and "call_usage"."decision_count" >= 0 and "call_usage"."generation_count" >= 0 and "call_usage"."cards_delivered" >= 0 and "call_usage"."dropped_chunks" >= 0 and "call_usage"."cost_total_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"seller_membership_id" uuid NOT NULL,
	"deal_id" uuid,
	"contact_id" uuid,
	"conversation_id" uuid,
	"calendar_event_id" text,
	"meeting_provider" "meeting_provider" NOT NULL,
	"meeting_external_id" text,
	"meeting_title" text,
	"status" "live_call_session_status" DEFAULT 'DETECTED' NOT NULL,
	"capture_mode" "live_capture_mode" DEFAULT 'UNKNOWN' NOT NULL,
	"transcription_mode" "live_transcription_mode" DEFAULT 'FIXTURE' NOT NULL,
	"current_phase" "call_phase" DEFAULT 'INTRODUCTION' NOT NULL,
	"phase_confidence" real DEFAULT 0.5 NOT NULL,
	"phase_origin" text DEFAULT 'HEURISTIC' NOT NULL,
	"memory" jsonb DEFAULT '{"phase":"INTRODUCTION","phaseConfidence":0.5,"pains":[],"objections":[],"openQuestions":[],"buyingSignals":[],"sellerActions":[],"lastInterventionId":null,"lastSequence":0}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"failure_code" text,
	"detection_confidence" real DEFAULT 0 NOT NULL,
	"detection_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_call_sessions_confidence_check" CHECK ("live_call_sessions"."phase_confidence" between 0 and 1 and "live_call_sessions"."detection_confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "live_call_sessions_organization_id_uidx" ON "live_call_sessions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE TABLE "live_transcript_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"live_call_session_id" uuid NOT NULL,
	"client_turn_id" text NOT NULL,
	"speaker_role" "live_speaker_role" NOT NULL,
	"speaker_origin" text NOT NULL,
	"speaker_confidence" real NOT NULL,
	"text" text NOT NULL,
	"is_partial" boolean DEFAULT false NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"confidence" real,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"sequence" integer NOT NULL,
	"commercial_event_id" uuid,
	"transcript_final_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_transcript_turns_values_check" CHECK (length(trim("live_transcript_turns"."text")) > 0 and "live_transcript_turns"."sequence" >= 0 and not ("live_transcript_turns"."is_partial" and "live_transcript_turns"."is_final") and "live_transcript_turns"."speaker_confidence" between 0 and 1 and ("live_transcript_turns"."confidence" is null or "live_transcript_turns"."confidence" between 0 and 1))
);
--> statement-breakpoint
ALTER TABLE "commercial_events" DROP CONSTRAINT "commercial_events_context_check";--> statement-breakpoint
ALTER TABLE "intelligence_jobs" DROP CONSTRAINT "intelligence_jobs_attempts_check";--> statement-breakpoint
ALTER TABLE "intelligence_settings" DROP CONSTRAINT "intelligence_settings_card_limits_check";--> statement-breakpoint
DROP INDEX "intelligence_jobs_claim_idx";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "live_call_session_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "live_transcript_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD COLUMN "live_call_session_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD COLUMN "live_transcript_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "intelligence_jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_jobs" ADD COLUMN "source" text DEFAULT 'ASYNC' NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_jobs" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_calls_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "meet_detection_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "zoom_detection_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_transcription_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_copilot_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_generation_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "call_auto_start_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "raw_live_audio_retention_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_transcript_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_max_buffer_bytes" integer DEFAULT 4194304 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_turn_aggregation_gap_ms" integer DEFAULT 1200 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "live_card_ttl_seconds" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "intervention_deliveries" ADD COLUMN "live_call_session_id" uuid;--> statement-breakpoint
ALTER TABLE "intervention_deliveries" ADD COLUMN "live_transcript_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "realtime_events" ADD COLUMN "live_call_session_id" uuid;--> statement-breakpoint
ALTER TABLE "call_consent_records" ADD CONSTRAINT "call_consent_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_consent_records" ADD CONSTRAINT "call_consent_records_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_consent_records" ADD CONSTRAINT "call_consent_records_organization_confirmer_fk" FOREIGN KEY ("organization_id","confirmed_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_usage" ADD CONSTRAINT "call_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_usage" ADD CONSTRAINT "call_usage_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_usage" ADD CONSTRAINT "call_usage_organization_seller_fk" FOREIGN KEY ("organization_id","seller_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_organization_seller_fk" FOREIGN KEY ("organization_id","seller_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_organization_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transcript_turns" ADD CONSTRAINT "live_transcript_turns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_transcript_turns" ADD CONSTRAINT "live_transcript_turns_organization_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_consent_records_organization_id_uidx" ON "call_consent_records" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_consent_records_session_uidx" ON "call_consent_records" USING btree ("organization_id","live_call_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_usage_organization_id_uidx" ON "call_usage" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_usage_session_uidx" ON "call_usage" USING btree ("organization_id","live_call_session_id");--> statement-breakpoint
CREATE INDEX "live_call_sessions_seller_status_idx" ON "live_call_sessions" USING btree ("organization_id","seller_membership_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_call_sessions_one_active_seller_uidx" ON "live_call_sessions" USING btree ("organization_id","seller_membership_id") WHERE "live_call_sessions"."status" in ('STARTING', 'ACTIVE', 'ENDING');--> statement-breakpoint
CREATE UNIQUE INDEX "live_transcript_turns_organization_id_uidx" ON "live_transcript_turns" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_transcript_turns_client_uidx" ON "live_transcript_turns" USING btree ("organization_id","live_call_session_id","client_turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_transcript_turns_final_sequence_uidx" ON "live_transcript_turns" USING btree ("organization_id","live_call_session_id","sequence") WHERE "live_transcript_turns"."is_final" = true;--> statement-breakpoint
CREATE INDEX "live_transcript_turns_session_sequence_idx" ON "live_transcript_turns" USING btree ("organization_id","live_call_session_id","sequence");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_live_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_live_turn_fk" FOREIGN KEY ("organization_id","live_transcript_turn_id") REFERENCES "public"."live_transcript_turns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_live_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_live_turn_fk" FOREIGN KEY ("organization_id","live_transcript_turn_id") REFERENCES "public"."live_transcript_turns"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_deliveries" ADD CONSTRAINT "intervention_deliveries_organization_live_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_deliveries" ADD CONSTRAINT "intervention_deliveries_organization_live_turn_fk" FOREIGN KEY ("organization_id","live_transcript_turn_id") REFERENCES "public"."live_transcript_turns"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_organization_live_session_fk" FOREIGN KEY ("organization_id","live_call_session_id") REFERENCES "public"."live_call_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_jobs_claim_idx" ON "intelligence_jobs" USING btree ("status","priority","available_at","created_at");--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_context_check" CHECK ("commercial_events"."contact_id" is not null or "commercial_events"."deal_id" is not null or "commercial_events"."conversation_id" is not null or "commercial_events"."message_id" is not null or "commercial_events"."live_call_session_id" is not null or "commercial_events"."live_transcript_turn_id" is not null);--> statement-breakpoint
ALTER TABLE "intelligence_jobs" ADD CONSTRAINT "intelligence_jobs_attempts_check" CHECK ("intelligence_jobs"."attempts" >= 0 and "intelligence_jobs"."priority" between 0 and 100);--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD CONSTRAINT "intelligence_settings_card_limits_check" CHECK ("intelligence_settings"."max_cards_per_window" > 0 and "intelligence_settings"."card_window_seconds" >= 30 and "intelligence_settings"."cooldown_seconds" >= 0 and "intelligence_settings"."minimum_priority" between 0 and 100 and "intelligence_settings"."delivery_ttl_seconds" >= 30 and "intelligence_settings"."max_generation_input_characters" between 500 and 20000 and "intelligence_settings"."max_generation_output_characters" between 100 and 2000 and "intelligence_settings"."organization_generation_budget_micros" >= 0 and "intelligence_settings"."seller_generation_budget_micros" >= 0 and "intelligence_settings"."max_cost_per_intervention_micros" >= 0 and "intelligence_settings"."audio_retention_days" between 1 and 3650 and "intelligence_settings"."transcript_retention_days" between 1 and 3650 and "intelligence_settings"."max_audio_bytes" between 1024 and 104857600 and "intelligence_settings"."raw_live_audio_retention_days" between 0 and 3650 and "intelligence_settings"."live_transcript_retention_days" between 1 and 3650 and "intelligence_settings"."live_max_buffer_bytes" between 65536 and 67108864 and "intelligence_settings"."live_turn_aggregation_gap_ms" between 100 and 10000 and "intelligence_settings"."live_card_ttl_seconds" between 5 and 300);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "live_call_sessions", "call_consent_records", "live_transcript_turns", "call_usage" TO morubi_app;
--> statement-breakpoint
ALTER TABLE "live_call_sessions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "live_call_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_consent_records" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_consent_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "live_transcript_turns" ENABLE ROW LEVEL SECURITY; ALTER TABLE "live_transcript_turns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "call_usage" ENABLE ROW LEVEL SECURITY; ALTER TABLE "call_usage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "live_call_sessions_tenant_policy" ON "live_call_sessions" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_consent_records_tenant_policy" ON "call_consent_records" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "live_transcript_turns_tenant_policy" ON "live_transcript_turns" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "call_usage_tenant_policy" ON "call_usage" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
