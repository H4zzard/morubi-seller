DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morubi_worker') THEN
    RAISE EXCEPTION 'Role morubi_worker must be provisioned before applying migrations';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.morubi_worker_queue_snapshot()
RETURNS TABLE (
  organization_id uuid,
  stale_live_sessions integer,
  transcription_pending integer,
  audio_retention_pending integer,
  transcript_retention_pending integer,
  intelligence_pending integer,
  generation_pending integer,
  post_call_pending integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    o.id,
    (
      SELECT count(*)::integer
      FROM public.live_call_sessions s
      WHERE s.organization_id = o.id
        AND s.status IN ('STARTING', 'ACTIVE', 'ENDING')
        AND s.last_heartbeat_at < now() - interval '60 seconds'
    ),
    (
      SELECT count(*)::integer
      FROM public.transcription_jobs j
      WHERE j.organization_id = o.id
        AND (j.status IN ('PENDING', 'RETRY') OR (j.status = 'PROCESSING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    ),
    (
      SELECT count(*)::integer
      FROM public.audio_assets a
      WHERE a.organization_id = o.id
        AND a.retention_until < now()
        AND a.status IN ('READY', 'TRANSCRIBED', 'FAILED')
    ),
    (
      SELECT count(*)::integer
      FROM public.audio_transcripts t
      LEFT JOIN public.intelligence_settings s ON s.organization_id = t.organization_id
      WHERE t.organization_id = o.id
        AND t.created_at < now() - make_interval(days => coalesce(s.transcript_retention_days, 90))
    ),
    (
      SELECT count(*)::integer
      FROM public.intelligence_jobs j
      WHERE j.organization_id = o.id
        AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    ),
    (
      SELECT count(*)::integer
      FROM public.generation_jobs j
      WHERE j.organization_id = o.id
        AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    ),
    (
      SELECT count(*)::integer
      FROM public.post_call_jobs j
      WHERE j.organization_id = o.id
        AND (j.status IN ('PENDING', 'RETRY') OR (j.status = 'PROCESSING' AND j.locked_at < now() - interval '10 minutes'))
        AND j.available_at <= now()
    )
  FROM public.organizations o
  WHERE
    EXISTS (
      SELECT 1 FROM public.live_call_sessions s
      WHERE s.organization_id = o.id
        AND s.status IN ('STARTING', 'ACTIVE', 'ENDING')
        AND s.last_heartbeat_at < now() - interval '60 seconds'
    )
    OR EXISTS (
      SELECT 1 FROM public.transcription_jobs j
      WHERE j.organization_id = o.id
        AND (j.status IN ('PENDING', 'RETRY') OR (j.status = 'PROCESSING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    )
    OR EXISTS (
      SELECT 1 FROM public.audio_assets a
      WHERE a.organization_id = o.id
        AND a.retention_until < now()
        AND a.status IN ('READY', 'TRANSCRIBED', 'FAILED')
    )
    OR EXISTS (
      SELECT 1 FROM public.audio_transcripts t
      LEFT JOIN public.intelligence_settings s ON s.organization_id = t.organization_id
      WHERE t.organization_id = o.id
        AND t.created_at < now() - make_interval(days => coalesce(s.transcript_retention_days, 90))
    )
    OR EXISTS (
      SELECT 1 FROM public.intelligence_jobs j
      WHERE j.organization_id = o.id
        AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    )
    OR EXISTS (
      SELECT 1 FROM public.generation_jobs j
      WHERE j.organization_id = o.id
        AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j.locked_at < now() - interval '5 minutes'))
        AND j.available_at <= now()
    )
    OR EXISTS (
      SELECT 1 FROM public.post_call_jobs j
      WHERE j.organization_id = o.id
        AND (j.status IN ('PENDING', 'RETRY') OR (j.status = 'PROCESSING' AND j.locked_at < now() - interval '10 minutes'))
        AND j.available_at <= now()
    );
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.morubi_worker_queue_snapshot() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM morubi_worker;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO morubi_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.morubi_worker_queue_snapshot() TO morubi_worker;
