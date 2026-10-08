CREATE TYPE "public"."intelligence_job_status" AS ENUM(
	'PENDING',
	'RUNNING',
	'COMPLETED',
	'FAILED'
);
--> statement-breakpoint

CREATE TYPE "public"."intervention_category" AS ENUM(
	'OBJECTION',
	'BUYING_SIGNAL',
	'RISK',
	'DISCOVERY_GAP',
	'NEXT_STEP',
	'INFORMATION'
);
--> statement-breakpoint

CREATE TYPE "public"."intervention_delivery_status" AS ENUM(
	'CREATED',
	'DELIVERED',
	'VIEWED',
	'DISMISSED',
	'APPLIED',
	'EXPIRED'
);
--> statement-breakpoint

CREATE TYPE "public"."intervention_feedback_rating" AS ENUM(
	'HELPFUL',
	'NOT_HELPFUL'
);
--> statement-breakpoint


CREATE TABLE "conversation_read_states" (
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"last_read_message_at" timestamp with time zone,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "conversation_read_states_organization_id_conversation_id_membership_id_pk"
	PRIMARY KEY("organization_id","conversation_id","membership_id")
);
--> statement-breakpoint


CREATE TABLE "intelligence_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"commercial_event_id" uuid NOT NULL,
	"processing_key" text NOT NULL,
	"status" "intelligence_job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "intelligence_jobs_attempts_check"
	CHECK ("intelligence_jobs"."attempts" >= 0)
);
--> statement-breakpoint


CREATE TABLE "intervention_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"seller_membership_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"category" "intervention_category" NOT NULL,
	"priority" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"guidance" text NOT NULL,
	"suggested_question" text,
	"status" "intervention_delivery_status" DEFAULT 'CREATED' NOT NULL,
	"correlation_id" text NOT NULL,
	"source_event_occurred_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"end_to_end_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "intervention_deliveries_priority_check"
	CHECK ("intervention_deliveries"."priority" between 0 and 100)
);
--> statement-breakpoint

-- Precisa existir antes da FK composta de intervention_feedback.
CREATE UNIQUE INDEX "intervention_deliveries_organization_id_uidx"
ON "intervention_deliveries"
USING btree ("organization_id","id");
--> statement-breakpoint


CREATE TABLE "intervention_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"seller_membership_id" uuid NOT NULL,
	"rating" "intervention_feedback_rating" NOT NULL,
	"action_taken" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "realtime_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"seller_membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"correlation_id" text NOT NULL,
	"conversation_id" uuid,
	"deal_id" uuid,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "realtime_events_type_check"
	CHECK (
		"realtime_events"."type" in (
			'intervention.created',
			'intervention.updated',
			'deal_state.updated'
		)
	),

	CONSTRAINT "realtime_events_version_check"
	CHECK ("realtime_events"."version" = 1)
);
--> statement-breakpoint


ALTER TABLE "intelligence_settings"
ADD COLUMN "realtime_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "feedback_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "max_cards_per_window" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "card_window_seconds" integer DEFAULT 900 NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "cooldown_seconds" integer DEFAULT 180 NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "minimum_priority" integer DEFAULT 40 NOT NULL;
--> statement-breakpoint

ALTER TABLE "intelligence_settings"
ADD COLUMN "delivery_ttl_seconds" integer DEFAULT 900 NOT NULL;
--> statement-breakpoint


ALTER TABLE "conversation_read_states"
ADD CONSTRAINT "conversation_read_states_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "conversation_read_states"
ADD CONSTRAINT "conversation_read_states_organization_conversation_fk"
FOREIGN KEY ("organization_id","conversation_id")
REFERENCES "public"."conversations"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "conversation_read_states"
ADD CONSTRAINT "conversation_read_states_organization_membership_fk"
FOREIGN KEY ("organization_id","membership_id")
REFERENCES "public"."memberships"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intelligence_jobs"
ADD CONSTRAINT "intelligence_jobs_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intelligence_jobs"
ADD CONSTRAINT "intelligence_jobs_organization_event_fk"
FOREIGN KEY ("organization_id","commercial_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intervention_deliveries"
ADD CONSTRAINT "intervention_deliveries_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_deliveries"
ADD CONSTRAINT "intervention_deliveries_organization_candidate_fk"
FOREIGN KEY ("organization_id","candidate_id")
REFERENCES "public"."intervention_candidates"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_deliveries"
ADD CONSTRAINT "intervention_deliveries_organization_seller_fk"
FOREIGN KEY ("organization_id","seller_membership_id")
REFERENCES "public"."memberships"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_deliveries"
ADD CONSTRAINT "intervention_deliveries_organization_conversation_fk"
FOREIGN KEY ("organization_id","conversation_id")
REFERENCES "public"."conversations"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_deliveries"
ADD CONSTRAINT "intervention_deliveries_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intervention_feedback"
ADD CONSTRAINT "intervention_feedback_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_feedback"
ADD CONSTRAINT "intervention_feedback_organization_delivery_fk"
FOREIGN KEY ("organization_id","delivery_id")
REFERENCES "public"."intervention_deliveries"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_feedback"
ADD CONSTRAINT "intervention_feedback_organization_seller_fk"
FOREIGN KEY ("organization_id","seller_membership_id")
REFERENCES "public"."memberships"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "realtime_events"
ADD CONSTRAINT "realtime_events_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "realtime_events"
ADD CONSTRAINT "realtime_events_organization_seller_fk"
FOREIGN KEY ("organization_id","seller_membership_id")
REFERENCES "public"."memberships"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "realtime_events"
ADD CONSTRAINT "realtime_events_organization_conversation_fk"
FOREIGN KEY ("organization_id","conversation_id")
REFERENCES "public"."conversations"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "realtime_events"
ADD CONSTRAINT "realtime_events_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


CREATE INDEX "conversation_read_states_membership_idx"
ON "conversation_read_states"
USING btree ("organization_id","membership_id","updated_at");
--> statement-breakpoint


CREATE UNIQUE INDEX "intelligence_jobs_processing_key_uidx"
ON "intelligence_jobs"
USING btree ("organization_id","processing_key");
--> statement-breakpoint

CREATE INDEX "intelligence_jobs_claim_idx"
ON "intelligence_jobs"
USING btree ("status","available_at","created_at");
--> statement-breakpoint


CREATE UNIQUE INDEX "intervention_deliveries_candidate_uidx"
ON "intervention_deliveries"
USING btree ("organization_id","candidate_id");
--> statement-breakpoint

CREATE INDEX "intervention_deliveries_current_idx"
ON "intervention_deliveries"
USING btree (
	"organization_id",
	"seller_membership_id",
	"conversation_id",
	"status",
	"expires_at"
);
--> statement-breakpoint

CREATE INDEX "intervention_deliveries_dedupe_idx"
ON "intervention_deliveries"
USING btree (
	"organization_id",
	"seller_membership_id",
	"dedupe_key",
	"created_at"
);
--> statement-breakpoint


CREATE UNIQUE INDEX "intervention_feedback_delivery_seller_uidx"
ON "intervention_feedback"
USING btree (
	"organization_id",
	"delivery_id",
	"seller_membership_id"
);
--> statement-breakpoint


CREATE UNIQUE INDEX "realtime_events_organization_id_uidx"
ON "realtime_events"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE INDEX "realtime_events_replay_idx"
ON "realtime_events"
USING btree (
	"organization_id",
	"seller_membership_id",
	"occurred_at",
	"id"
);
--> statement-breakpoint


ALTER TABLE "intelligence_settings"
ADD CONSTRAINT "intelligence_settings_card_limits_check"
CHECK (
	"intelligence_settings"."max_cards_per_window" > 0
	AND "intelligence_settings"."card_window_seconds" >= 30
	AND "intelligence_settings"."cooldown_seconds" >= 0
	AND "intelligence_settings"."minimum_priority" between 0 and 100
	AND "intelligence_settings"."delivery_ttl_seconds" >= 30
);
--> statement-breakpoint


GRANT SELECT, INSERT, UPDATE
ON TABLE
	"conversation_read_states",
	"intelligence_jobs",
	"intervention_deliveries",
	"intervention_feedback"
TO morubi_app;
--> statement-breakpoint

GRANT SELECT, INSERT
ON TABLE "realtime_events"
TO morubi_app;
--> statement-breakpoint


ALTER TABLE "conversation_read_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_read_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intelligence_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intelligence_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intervention_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intervention_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intervention_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intervention_feedback" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "realtime_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "realtime_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint


CREATE POLICY "conversation_read_states_tenant_policy"
ON "conversation_read_states"
FOR ALL
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
)
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint


CREATE POLICY "intelligence_jobs_tenant_policy"
ON "intelligence_jobs"
FOR ALL
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
)
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint


CREATE POLICY "intervention_deliveries_tenant_policy"
ON "intervention_deliveries"
FOR ALL
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
)
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint


CREATE POLICY "intervention_feedback_tenant_policy"
ON "intervention_feedback"
FOR ALL
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
)
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint


CREATE POLICY "realtime_events_tenant_policy"
ON "realtime_events"
FOR ALL
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
)
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);