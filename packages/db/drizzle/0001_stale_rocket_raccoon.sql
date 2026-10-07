CREATE TYPE "public"."commercial_event_actor_type" AS ENUM('SELLER', 'LEAD', 'MANAGER', 'SYSTEM', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."commercial_event_source" AS ENUM('CRM', 'WHATSAPP', 'EMAIL', 'MEET', 'ZOOM', 'MANUAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."commercial_event_type" AS ENUM('MESSAGE', 'NOTE', 'CALL', 'TRANSCRIPT', 'STATUS_CHANGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."conversation_channel" AS ENUM('WHATSAPP', 'CRM_CHAT', 'EMAIL', 'SMS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('OPEN', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."external_entity_type" AS ENUM('CONTACT', 'DEAL', 'CONVERSATION', 'MESSAGE', 'COMMERCIAL_EVENT');--> statement-breakpoint
CREATE TYPE "public"."message_content_type" AS ENUM('TEXT', 'AUDIO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."message_sender_type" AS ENUM('SELLER', 'LEAD', 'SYSTEM', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('CONTACT', 'MEMBERSHIP', 'EXTERNAL', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('SYNCED', 'STALE', 'ERROR');--> statement-breakpoint
CREATE TABLE "commercial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schema_version" text DEFAULT '1' NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"actor_type" "commercial_event_actor_type" NOT NULL,
	"source" "commercial_event_source" NOT NULL,
	"type" "commercial_event_type" NOT NULL,
	"text" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_record_id" uuid,
	"supersedes_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_events_context_check" CHECK ("commercial_events"."contact_id" is not null or "commercial_events"."deal_id" is not null or "commercial_events"."conversation_id" is not null or "commercial_events"."message_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company_name" text,
	"job_title" text,
	"primary_provider" text,
	"sync_status" "sync_status" DEFAULT 'SYNCED' NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"type" "participant_type" NOT NULL,
	"contact_id" uuid,
	"membership_id" uuid,
	"external_participant_id" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject" text,
	"channel" "conversation_channel" NOT NULL,
	"primary_contact_id" uuid,
	"deal_id" uuid,
	"primary_provider" text,
	"provider_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_contacts" (
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_contacts_deal_id_contact_id_pk" PRIMARY KEY("deal_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint,
	"currency" text,
	"status" "deal_status" DEFAULT 'OPEN' NOT NULL,
	"provider_stage_id" text,
	"provider_stage_label" text,
	"owner_membership_id" uuid,
	"primary_provider" text,
	"sync_status" "sync_status" DEFAULT 'SYNCED' NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_currency_check" CHECK ("deals"."currency" is null or "deals"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "deals_amount_minor_check" CHECK ("deals"."amount_minor" is null or "deals"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_entity_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_workspace_id" text DEFAULT '' NOT NULL,
	"connection_id" uuid,
	"entity_type" "external_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_participant_id" uuid,
	"sender_type" "message_sender_type" NOT NULL,
	"sender_display_name" text,
	"content_type" "message_content_type" NOT NULL,
	"text" text,
	"provider" text NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_hash" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_text_content_check" CHECK ("messages"."content_type" <> 'TEXT' or "messages"."text" is not null or "messages"."deleted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_workspace_id" text DEFAULT '' NOT NULL,
	"connection_id" uuid,
	"entity_type" "external_entity_type" NOT NULL,
	"external_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"provider_updated_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"normalized_entity_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_events_organization_id_uidx" ON "commercial_events" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_organization_id_uidx" ON "contacts" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_organization_id_uidx" ON "conversation_participants" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_organization_id_uidx" ON "conversations" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_organization_id_uidx" ON "deals" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_organization_id_uidx" ON "messages" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_organization_id_uidx" ON "source_records" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_organization_id_uidx" ON "memberships" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE SET NULL ("deal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."messages"("organization_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_source_record_fk" FOREIGN KEY ("organization_id","source_record_id") REFERENCES "public"."source_records"("organization_id","id") ON DELETE SET NULL ("source_record_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_organization_supersedes_fk" FOREIGN KEY ("organization_id","supersedes_event_id") REFERENCES "public"."commercial_events"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_organization_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_organization_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE SET NULL ("membership_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_contact_fk" FOREIGN KEY ("organization_id","primary_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE SET NULL ("primary_contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE SET NULL ("deal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_organization_deal_fk" FOREIGN KEY ("organization_id","deal_id") REFERENCES "public"."deals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contacts" ADD CONSTRAINT "deal_contacts_organization_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_owner_fk" FOREIGN KEY ("organization_id","owner_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE SET NULL ("owner_membership_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_entity_identities" ADD CONSTRAINT "external_entity_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_sender_fk" FOREIGN KEY ("organization_id","sender_participant_id") REFERENCES "public"."conversation_participants"("organization_id","id") ON DELETE SET NULL ("sender_participant_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_events_timeline_idx" ON "commercial_events" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "contacts_organization_updated_idx" ON "contacts" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "contacts_organization_name_idx" ON "contacts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "conversation_participants_conversation_idx" ON "conversation_participants" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_organization_last_message_idx" ON "conversations" USING btree ("organization_id","last_message_at","id");--> statement-breakpoint
CREATE INDEX "deal_contacts_organization_contact_idx" ON "deal_contacts" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "deals_organization_updated_idx" ON "deals" USING btree ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "deals_organization_status_idx" ON "deals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_strong_uidx" ON "external_entity_identities" USING btree ("organization_id","provider","external_workspace_id","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "external_identities_entity_idx" ON "external_entity_identities" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_occurred_idx" ON "messages" USING btree ("organization_id","conversation_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_idempotency_uidx" ON "source_records" USING btree ("organization_id","provider","external_workspace_id","entity_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "source_records_entity_history_idx" ON "source_records" USING btree ("organization_id","entity_type","normalized_entity_id","ingested_at");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "contacts_search_trgm_idx" ON "contacts" USING gin ((coalesce("name", '') || ' ' || coalesce("email", '') || ' ' || coalesce("phone", '') || ' ' || coalesce("company_name", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "deals_title_trgm_idx" ON "deals" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "conversations_subject_trgm_idx" ON "conversations" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "contacts", "deals", "deal_contacts", "conversations", "conversation_participants", "messages", "external_entity_identities", "source_records", "commercial_events" TO morubi_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "source_records", "commercial_events" FROM morubi_app;--> statement-breakpoint

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deal_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_entity_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_entity_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commercial_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commercial_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "contacts_tenant_policy" ON "contacts" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "deals_tenant_policy" ON "deals" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "deal_contacts_tenant_policy" ON "deal_contacts" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "conversations_tenant_policy" ON "conversations" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "conversation_participants_tenant_policy" ON "conversation_participants" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "messages_tenant_policy" ON "messages" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "external_identities_tenant_policy" ON "external_entity_identities" FOR ALL TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_records_select_policy" ON "source_records" FOR SELECT TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_records_insert_policy" ON "source_records" FOR INSERT TO morubi_app
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "commercial_events_select_policy" ON "commercial_events" FOR SELECT TO morubi_app
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "commercial_events_insert_policy" ON "commercial_events" FOR INSERT TO morubi_app
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
