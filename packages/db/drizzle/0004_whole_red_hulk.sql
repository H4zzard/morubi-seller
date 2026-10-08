CREATE TYPE "public"."ai_decision_policy_result" AS ENUM(
	'ALLOW',
	'SUPPRESS',
	'ESCALATE',
	'SHADOW',
	'REQUIRE_MORE_CONTEXT'
);
--> statement-breakpoint

CREATE TYPE "public"."intervention_outcome" AS ENUM(
	'MATCHED',
	'GENERATION_REQUIRED',
	'SUPPRESSED'
);
--> statement-breakpoint

CREATE TYPE "public"."intervention_template_status" AS ENUM(
	'ACTIVE',
	'INACTIVE'
);
--> statement-breakpoint

CREATE TYPE "public"."memory_fact_status" AS ENUM(
	'ACTIVE',
	'SUPERSEDED',
	'REJECTED'
);
--> statement-breakpoint

CREATE TYPE "public"."memory_scope_type" AS ENUM(
	'DEAL_FACT',
	'CONTACT_FACT',
	'SELLER_PATTERN',
	'COMPANY_PATTERN',
	'PLAYBOOK_REFERENCE'
);
--> statement-breakpoint


CREATE TABLE "ai_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"commercial_event_id" uuid NOT NULL,
	"processing_key" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"config_version" text NOT NULL,
	"decision_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"context_version" text NOT NULL,
	"output" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"policy_result" "ai_decision_policy_result" NOT NULL,
	"policy_reason" text NOT NULL,
	"shadow_mode" boolean DEFAULT true NOT NULL,
	"input_size" integer DEFAULT 0 NOT NULL,
	"output_size" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Precisa existir antes de qualquer FK composta apontando para ai_decisions.
CREATE UNIQUE INDEX "ai_decisions_organization_id_uidx"
ON "ai_decisions"
USING btree ("organization_id","id");
--> statement-breakpoint


CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ai_decision_id" uuid,
	"deal_id" uuid NOT NULL,
	"commercial_event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"success" boolean NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"input_size" integer DEFAULT 0 NOT NULL,
	"output_size" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "deal_state_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source_event_id" uuid NOT NULL,
	"ai_decision_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "deal_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_relevant_event_id" uuid,
	"last_decision_id" uuid,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "intelligence_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"intelligence_enabled" boolean DEFAULT false NOT NULL,
	"jev_enabled" boolean DEFAULT false NOT NULL,
	"shadow_mode" boolean DEFAULT true NOT NULL,
	"interventions_visible" boolean DEFAULT false NOT NULL,
	"thresholds" jsonb NOT NULL,
	"policy_version" text DEFAULT 'policy-v1' NOT NULL,
	"context_version" text DEFAULT 'context-v1' NOT NULL,
	"decision_version" text DEFAULT 'decision-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "intervention_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"commercial_event_id" uuid NOT NULL,
	"ai_decision_id" uuid NOT NULL,
	"template_id" uuid,
	"outcome" "intervention_outcome" NOT NULL,
	"title" text,
	"guidance" text,
	"question" text,
	"source" text NOT NULL,
	"confidence" real NOT NULL,
	"policy_result" "ai_decision_policy_result" NOT NULL,
	"shadow_mode" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "intervention_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"subtype" text,
	"strategy" text NOT NULL,
	"title" text NOT NULL,
	"guidance" text NOT NULL,
	"suggested_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "intervention_template_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint


CREATE TABLE "memory_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" "memory_scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"value" text NOT NULL,
	"value_fingerprint" text NOT NULL,
	"confidence" real NOT NULL,
	"source_event_ids" jsonb NOT NULL,
	"status" "memory_fact_status" DEFAULT 'ACTIVE' NOT NULL,
	"ai_decision_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Precisa existir antes da FK autorreferencial composta.
CREATE UNIQUE INDEX "memory_facts_organization_id_uidx"
ON "memory_facts"
USING btree ("organization_id","id");
--> statement-breakpoint


ALTER TABLE "ai_decisions"
ADD CONSTRAINT "ai_decisions_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_decisions"
ADD CONSTRAINT "ai_decisions_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_decisions"
ADD CONSTRAINT "ai_decisions_organization_event_fk"
FOREIGN KEY ("organization_id","commercial_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_organization_decision_fk"
FOREIGN KEY ("organization_id","ai_decision_id")
REFERENCES "public"."ai_decisions"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_usage"
ADD CONSTRAINT "ai_usage_organization_event_fk"
FOREIGN KEY ("organization_id","commercial_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "deal_state_revisions"
ADD CONSTRAINT "deal_state_revisions_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_state_revisions"
ADD CONSTRAINT "deal_state_revisions_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_state_revisions"
ADD CONSTRAINT "deal_state_revisions_organization_event_fk"
FOREIGN KEY ("organization_id","source_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_state_revisions"
ADD CONSTRAINT "deal_state_revisions_organization_decision_fk"
FOREIGN KEY ("organization_id","ai_decision_id")
REFERENCES "public"."ai_decisions"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "deal_states"
ADD CONSTRAINT "deal_states_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_states"
ADD CONSTRAINT "deal_states_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_states"
ADD CONSTRAINT "deal_states_organization_event_fk"
FOREIGN KEY ("organization_id","last_relevant_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE SET NULL ("last_relevant_event_id")
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "deal_states"
ADD CONSTRAINT "deal_states_organization_decision_fk"
FOREIGN KEY ("organization_id","last_decision_id")
REFERENCES "public"."ai_decisions"("organization_id","id")
ON DELETE SET NULL ("last_decision_id")
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intelligence_settings"
ADD CONSTRAINT "intelligence_settings_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_template_id_intervention_templates_id_fk"
FOREIGN KEY ("template_id")
REFERENCES "public"."intervention_templates"("id")
ON DELETE set null
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_organization_deal_fk"
FOREIGN KEY ("organization_id","deal_id")
REFERENCES "public"."deals"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_organization_event_fk"
FOREIGN KEY ("organization_id","commercial_event_id")
REFERENCES "public"."commercial_events"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_organization_decision_fk"
FOREIGN KEY ("organization_id","ai_decision_id")
REFERENCES "public"."ai_decisions"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "intervention_templates"
ADD CONSTRAINT "intervention_templates_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint


ALTER TABLE "memory_facts"
ADD CONSTRAINT "memory_facts_organization_id_organizations_id_fk"
FOREIGN KEY ("organization_id")
REFERENCES "public"."organizations"("id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "memory_facts"
ADD CONSTRAINT "memory_facts_organization_decision_fk"
FOREIGN KEY ("organization_id","ai_decision_id")
REFERENCES "public"."ai_decisions"("organization_id","id")
ON DELETE cascade
ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "memory_facts"
ADD CONSTRAINT "memory_facts_organization_supersedes_fk"
FOREIGN KEY ("organization_id","supersedes_id")
REFERENCES "public"."memory_facts"("organization_id","id")
ON DELETE no action
ON UPDATE no action;
--> statement-breakpoint


CREATE UNIQUE INDEX "ai_decisions_processing_key_uidx"
ON "ai_decisions"
USING btree ("organization_id","processing_key");
--> statement-breakpoint

CREATE INDEX "ai_decisions_organization_created_idx"
ON "ai_decisions"
USING btree ("organization_id","created_at");
--> statement-breakpoint


CREATE UNIQUE INDEX "ai_usage_organization_id_uidx"
ON "ai_usage"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE UNIQUE INDEX "ai_usage_decision_uidx"
ON "ai_usage"
USING btree ("organization_id","ai_decision_id");
--> statement-breakpoint

CREATE INDEX "ai_usage_organization_created_idx"
ON "ai_usage"
USING btree ("organization_id","created_at");
--> statement-breakpoint


CREATE UNIQUE INDEX "deal_state_revisions_organization_id_uidx"
ON "deal_state_revisions"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE UNIQUE INDEX "deal_state_revisions_version_uidx"
ON "deal_state_revisions"
USING btree ("organization_id","deal_id","version");
--> statement-breakpoint

CREATE UNIQUE INDEX "deal_state_revisions_decision_uidx"
ON "deal_state_revisions"
USING btree ("organization_id","ai_decision_id");
--> statement-breakpoint


CREATE UNIQUE INDEX "deal_states_organization_id_uidx"
ON "deal_states"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE UNIQUE INDEX "deal_states_deal_uidx"
ON "deal_states"
USING btree ("organization_id","deal_id");
--> statement-breakpoint


CREATE UNIQUE INDEX "intervention_candidates_organization_id_uidx"
ON "intervention_candidates"
USING btree ("organization_id","id");
--> statement-breakpoint

CREATE UNIQUE INDEX "intervention_candidates_decision_uidx"
ON "intervention_candidates"
USING btree ("organization_id","ai_decision_id");
--> statement-breakpoint


CREATE UNIQUE INDEX "intervention_templates_scope_code_version_uidx"
ON "intervention_templates"
USING btree (
	coalesce(
		"organization_id",
		'00000000-0000-0000-0000-000000000000'::uuid
	),
	"code",
	"version"
);
--> statement-breakpoint

CREATE INDEX "intervention_templates_match_idx"
ON "intervention_templates"
USING btree ("organization_id","strategy","status");
--> statement-breakpoint


CREATE UNIQUE INDEX "memory_facts_decision_value_uidx"
ON "memory_facts"
USING btree (
	"organization_id",
	"ai_decision_id",
	"scope_type",
	"scope_id",
	"fact_type",
	"value_fingerprint"
);
--> statement-breakpoint

CREATE INDEX "memory_facts_scope_idx"
ON "memory_facts"
USING btree ("organization_id","scope_type","scope_id","status");
--> statement-breakpoint


ALTER TABLE "ai_decisions"
ADD CONSTRAINT "ai_decisions_confidence_check"
CHECK ("confidence" >= 0 AND "confidence" <= 1);
--> statement-breakpoint

ALTER TABLE "intervention_candidates"
ADD CONSTRAINT "intervention_candidates_confidence_check"
CHECK ("confidence" >= 0 AND "confidence" <= 1);
--> statement-breakpoint

ALTER TABLE "memory_facts"
ADD CONSTRAINT "memory_facts_confidence_check"
CHECK ("confidence" >= 0 AND "confidence" <= 1);
--> statement-breakpoint

ALTER TABLE "deal_state_revisions"
ADD CONSTRAINT "deal_state_revisions_version_check"
CHECK ("version" > 0);
--> statement-breakpoint

ALTER TABLE "deal_states"
ADD CONSTRAINT "deal_states_version_check"
CHECK ("version" >= 0);
--> statement-breakpoint


INSERT INTO "intervention_templates" (
	"id",
	"organization_id",
	"code",
	"category",
	"subtype",
	"strategy",
	"title",
	"guidance",
	"suggested_questions",
	"warnings",
	"conditions",
	"version",
	"status"
) VALUES
(
	'10000000-0000-4000-8000-000000000001',
	NULL,
	'global-handle-price-v1',
	'OBJECTION',
	'PRICE',
	'HANDLE_PRICE',
	'Investigue antes de negociar',
	'Entenda a diferença entre preço percebido e valor antes de discutir condições.',
	'["Qual resultado tornaria este investimento justificável?"]'::jsonb,
	'["Não ofereça desconto antes de entender a objeção."]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000002',
	NULL,
	'global-handle-competitor-v1',
	'OBJECTION',
	'COMPETITOR',
	'HANDLE_COMPETITOR',
	'Compare pelo resultado',
	'Investigue critérios e lacunas sem atacar o concorrente.',
	'["Quais critérios terão mais peso na decisão?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000003',
	NULL,
	'global-validate-authority-v1',
	'OBJECTION',
	'AUTHORITY',
	'VALIDATE_AUTHORITY',
	'Mapeie a decisão',
	'Confirme participantes, critérios e processo de aprovação.',
	'["Quem mais precisa participar desta decisão?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000004',
	NULL,
	'global-build-value-v1',
	'DISCOVERY',
	NULL,
	'BUILD_VALUE',
	'Conecte valor ao problema',
	'Retome impacto e resultado esperado antes de apresentar condições.',
	'["Qual impacto este problema gera hoje?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000005',
	NULL,
	'global-quantify-pain-v1',
	'DISCOVERY',
	NULL,
	'QUANTIFY_PAIN',
	'Quantifique o problema',
	'Transforme o problema declarado em impacto observável.',
	'["Quanto este cenário custa por mês?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000006',
	NULL,
	'global-create-urgency-v1',
	'RISK',
	'TIMING',
	'CREATE_URGENCY',
	'Explore o custo da espera',
	'Ajude o lead a comparar o custo de agir com o de adiar.',
	'["O que acontece se nada mudar neste trimestre?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000007',
	NULL,
	'global-secure-next-step-v1',
	'NEXT_STEP',
	NULL,
	'SECURE_NEXT_STEP',
	'Concretize o próximo passo',
	'Defina responsável, data e objetivo do próximo compromisso.',
	'["Podemos sair com data e participantes definidos?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000008',
	NULL,
	'global-clarify-v1',
	'DISCOVERY',
	NULL,
	'CLARIFY',
	'Esclareça a preocupação',
	'Faça uma pergunta curta antes de prescrever uma resposta.',
	'["Qual parte parece mais difícil hoje?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000009',
	NULL,
	'global-close-v1',
	'COMMITMENT',
	NULL,
	'CLOSE',
	'Confirme o compromisso',
	'Valide os últimos critérios e formalize o próximo compromisso.',
	'["Há algo que impeça formalizarmos agora?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
),
(
	'10000000-0000-4000-8000-000000000010',
	NULL,
	'global-follow-up-v1',
	'FOLLOW_UP',
	NULL,
	'FOLLOW_UP',
	'Preserve contexto com respeito',
	'Registre a razão e combine se existe um momento legítimo para retomar.',
	'["Faz sentido combinarmos uma data para reavaliar?"]'::jsonb,
	'[]'::jsonb,
	'{}'::jsonb,
	1,
	'ACTIVE'
);
--> statement-breakpoint


GRANT SELECT, INSERT
ON TABLE
	"ai_decisions",
	"ai_usage",
	"deal_state_revisions",
	"intervention_candidates"
TO morubi_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE
ON TABLE
	"deal_states",
	"memory_facts",
	"intelligence_settings"
TO morubi_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "intervention_templates"
TO morubi_app;
--> statement-breakpoint


ALTER TABLE "ai_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_decisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "deal_state_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_state_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "deal_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "memory_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intervention_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intervention_candidates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intervention_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intervention_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE "intelligence_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intelligence_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint


CREATE POLICY "ai_decisions_tenant_policy"
ON "ai_decisions"
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

CREATE POLICY "ai_usage_tenant_policy"
ON "ai_usage"
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

CREATE POLICY "deal_state_revisions_tenant_policy"
ON "deal_state_revisions"
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

CREATE POLICY "deal_states_tenant_policy"
ON "deal_states"
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

CREATE POLICY "memory_facts_tenant_policy"
ON "memory_facts"
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

CREATE POLICY "intervention_candidates_tenant_policy"
ON "intervention_candidates"
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

CREATE POLICY "intelligence_settings_tenant_policy"
ON "intelligence_settings"
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


CREATE POLICY "intervention_templates_select_policy"
ON "intervention_templates"
FOR SELECT
TO morubi_app
USING (
	"organization_id" IS NULL
	OR "organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint

CREATE POLICY "intervention_templates_insert_policy"
ON "intervention_templates"
FOR INSERT
TO morubi_app
WITH CHECK (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint

CREATE POLICY "intervention_templates_update_policy"
ON "intervention_templates"
FOR UPDATE
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

CREATE POLICY "intervention_templates_delete_policy"
ON "intervention_templates"
FOR DELETE
TO morubi_app
USING (
	"organization_id" =
	NULLIF(current_setting('app.current_organization_id', true), '')::uuid
);
--> statement-breakpoint


CREATE FUNCTION "assert_intervention_template_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.template_id IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM intervention_templates t
		WHERE t.id = NEW.template_id
			AND (
				t.organization_id IS NULL
				OR t.organization_id = NEW.organization_id
			)
	) THEN
		RAISE EXCEPTION 'intervention template is outside tenant scope'
		USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "intervention_candidates_template_scope_trigger"
BEFORE INSERT OR UPDATE OF template_id, organization_id
ON "intervention_candidates"
FOR EACH ROW
EXECUTE FUNCTION "assert_intervention_template_scope"();
--> statement-breakpoint


CREATE FUNCTION "assert_memory_fact_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.scope_type = 'DEAL_FACT' AND NOT EXISTS (
		SELECT 1
		FROM deals d
		WHERE d.id = NEW.scope_id
			AND d.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'memory deal scope is outside tenant scope'
		USING ERRCODE = '23514';
	END IF;

	IF NEW.scope_type = 'CONTACT_FACT' AND NOT EXISTS (
		SELECT 1
		FROM contacts c
		WHERE c.id = NEW.scope_id
			AND c.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'memory contact scope is outside tenant scope'
		USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "memory_facts_scope_trigger"
BEFORE INSERT OR UPDATE OF organization_id, scope_type, scope_id
ON "memory_facts"
FOR EACH ROW
EXECUTE FUNCTION "assert_memory_fact_scope"();