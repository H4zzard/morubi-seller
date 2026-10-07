CREATE TYPE "public"."generation_job_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."generation_validation_result" AS ENUM('VALID', 'INVALID', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."generative_execution_status" AS ENUM('RUNNING', 'COMPLETED', 'VALIDATION_FAILED', 'PROVIDER_FAILED', 'STALE', 'SUPPRESSED');--> statement-breakpoint
CREATE TYPE "public"."generative_profile" AS ENUM('FAST_GENERATION', 'DEEP_REASONING');--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"generation_key" text NOT NULL,
	"status" "generation_job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_attempts_check" CHECK ("generation_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "generative_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"ai_decision_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"commercial_event_id" uuid NOT NULL,
	"seller_membership_id" uuid,
	"conversation_id" uuid,
	"generation_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"profile" "generative_profile" NOT NULL,
	"status" "generative_execution_status" NOT NULL,
	"config_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"context_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"input_summary" jsonb NOT NULL,
	"output" jsonb,
	"validation_result" "generation_validation_result",
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"generation_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generation_completed_at" timestamp with time zone,
	"validation_completed_at" timestamp with time zone,
	"delivery_created_at" timestamp with time zone,
	"generation_latency_ms" integer,
	"generation_to_delivery_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_settings" DROP CONSTRAINT "intelligence_settings_card_limits_check";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "generative_execution_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "seller_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "intervention_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "profile" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "purpose" text DEFAULT 'DECISION' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "generative_ai_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "generate_in_shadow" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "company_rules" jsonb DEFAULT '["Não oferecer desconto sem aprovação.","Não inventar preço, prazo, feature ou condição comercial."]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "max_generation_input_characters" integer DEFAULT 6000 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "max_generation_output_characters" integer DEFAULT 700 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "organization_generation_budget_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "seller_generation_budget_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD COLUMN "max_cost_per_intervention_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_organization_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."intervention_candidates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_job_fk" FOREIGN KEY ("organization_id","generation_job_id") REFERENCES "public"."generation_jobs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_candidate_fk" FOREIGN KEY ("organization_id","candidate_id") REFERENCES "public"."intervention_candidates"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_decision_fk" FOREIGN KEY ("organization_id","ai_decision_id") REFERENCES "public"."ai_decisions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_event_fk" FOREIGN KEY ("organization_id","commercial_event_id") REFERENCES "public"."commercial_events"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_seller_fk" FOREIGN KEY ("organization_id","seller_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generative_executions" ADD CONSTRAINT "generative_executions_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_organization_id_uidx" ON "generation_jobs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_key_uidx" ON "generation_jobs" USING btree ("organization_id","generation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_candidate_uidx" ON "generation_jobs" USING btree ("organization_id","candidate_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_claim_idx" ON "generation_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generative_executions_organization_id_uidx" ON "generative_executions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "generative_executions_key_uidx" ON "generative_executions" USING btree ("organization_id","generation_key");--> statement-breakpoint
CREATE INDEX "generative_executions_usage_idx" ON "generative_executions" USING btree ("organization_id","provider","model","profile","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_generation_fk" FOREIGN KEY ("organization_id","generative_execution_id") REFERENCES "public"."generative_executions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_seller_fk" FOREIGN KEY ("organization_id","seller_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_candidate_fk" FOREIGN KEY ("organization_id","intervention_candidate_id") REFERENCES "public"."intervention_candidates"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_generation_uidx" ON "ai_usage" USING btree ("organization_id","generative_execution_id");--> statement-breakpoint
ALTER TABLE "intelligence_settings" ADD CONSTRAINT "intelligence_settings_card_limits_check" CHECK ("intelligence_settings"."max_cards_per_window" > 0 and "intelligence_settings"."card_window_seconds" >= 30 and "intelligence_settings"."cooldown_seconds" >= 0 and "intelligence_settings"."minimum_priority" between 0 and 100 and "intelligence_settings"."delivery_ttl_seconds" >= 30 and "intelligence_settings"."max_generation_input_characters" between 500 and 20000 and "intelligence_settings"."max_generation_output_characters" between 100 and 2000 and "intelligence_settings"."organization_generation_budget_micros" >= 0 and "intelligence_settings"."seller_generation_budget_micros" >= 0 and "intelligence_settings"."max_cost_per_intervention_micros" >= 0);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "generation_jobs", "generative_executions" TO morubi_app;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY; ALTER TABLE "generation_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "generative_executions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "generative_executions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "generation_jobs_tenant_policy" ON "generation_jobs" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "generative_executions_tenant_policy" ON "generative_executions" FOR ALL TO morubi_app USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid) WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
