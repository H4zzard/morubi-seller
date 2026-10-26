import type {
  GenerationJob,
  GenerationJobRepository,
  JobFailureOutcome,
  PostCallJob,
  PostCallJobRepository,
  PostCallProcessor
} from '@morubi/db';

export async function failGenerationJob(
  repository: Pick<GenerationJobRepository, 'fail'>,
  job: GenerationJob,
  error: unknown
): Promise<JobFailureOutcome> {
  return repository.fail(job, error);
}

export async function failPostCallJob(
  repository: Pick<PostCallJobRepository, 'fail'>,
  processor: Pick<PostCallProcessor, 'recordFailure'>,
  job: PostCallJob,
  error: unknown,
  latencyMs: number
): Promise<{
  failure: JobFailureOutcome;
  telemetryFailure?: { error: unknown };
}> {
  let telemetryFailure: { error: unknown } | undefined;
  try {
    await processor.recordFailure(job, error, latencyMs);
  } catch (telemetryError) {
    telemetryFailure = { error: telemetryError };
  }
  const failure = await repository.fail(job, error);
  return telemetryFailure ? { failure, telemetryFailure } : { failure };
}
