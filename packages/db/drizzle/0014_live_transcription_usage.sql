ALTER TABLE "call_usage"
  ADD COLUMN IF NOT EXISTS "transcription_input_tokens" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "transcription_output_tokens" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "usage_measurement" text DEFAULT 'ESTIMATED' NOT NULL;

ALTER TABLE "call_usage"
  DROP CONSTRAINT IF EXISTS "call_usage_nonnegative_check";

ALTER TABLE "call_usage"
  ADD CONSTRAINT "call_usage_nonnegative_check" CHECK (
    "call_duration_seconds" >= 0
    AND "audio_processed_seconds" >= 0
    AND "transcription_input_units" >= 0
    AND "transcription_input_tokens" >= 0
    AND "transcription_output_tokens" >= 0
    AND "usage_measurement" IN ('ACTUAL', 'ESTIMATED')
    AND "decision_count" >= 0
    AND "generation_count" >= 0
    AND "cards_delivered" >= 0
    AND "dropped_chunks" >= 0
    AND "cost_total_micros" >= 0
  );
