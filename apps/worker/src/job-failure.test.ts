import { describe, expect, it, vi } from 'vitest';
import type {
  GenerationJob,
  GenerationJobRepository,
  PostCallJob,
  PostCallJobRepository,
  PostCallProcessor
} from '@morubi/db';
import { failGenerationJob, failPostCallJob } from './job-failure.js';

const now = new Date('2026-10-22T12:00:00Z');

const generationJob: GenerationJob = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  candidateId: '00000000-0000-4000-8000-000000000003',
  generationKey: 'generation-key',
  status: 'RUNNING',
  attempts: 1,
  maxAttempts: 3,
  availableAt: now,
  lockedAt: now,
  finishedAt: null,
  correlationId: 'generation-correlation',
  errorCode: null,
  createdAt: now,
  updatedAt: now
};

const postCallJob: PostCallJob = {
  id: '00000000-0000-4000-8000-000000000004',
  organizationId: '00000000-0000-4000-8000-000000000002',
  liveCallSessionId: '00000000-0000-4000-8000-000000000005',
  transcriptVersion: 'transcript-v1',
  processingVersion: 'processing-v1',
  status: 'PROCESSING',
  attempts: 1,
  maxAttempts: 3,
  availableAt: now,
  lockedAt: now,
  finishedAt: null,
  correlationId: 'post-call-correlation',
  priority: 10,
  errorCode: null,
  createdAt: now,
  updatedAt: now
};

describe('worker job failure separation', () => {
  it('fails a GenerationJob only through GenerationJobRepository', async () => {
    const fail = vi.fn().mockResolvedValue({ terminal: false, errorCode: 'FIXTURE_500' });
    const repository: Pick<GenerationJobRepository, 'fail'> = { fail };

    await expect(
      failGenerationJob(repository, generationJob, new Error('FIXTURE_500'))
    ).resolves.toEqual({ terminal: false, errorCode: 'FIXTURE_500' });
    expect(fail).toHaveBeenCalledWith(generationJob, expect.any(Error));
  });

  it('records PostCallJob telemetry and then applies its own retry state', async () => {
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const fail = vi.fn().mockResolvedValue({ terminal: false, errorCode: 'FIXTURE_500' });
    const processor: Pick<PostCallProcessor, 'recordFailure'> = { recordFailure };
    const repository: Pick<PostCallJobRepository, 'fail'> = { fail };
    const error = new Error('FIXTURE_500');

    await expect(failPostCallJob(repository, processor, postCallJob, error, 25)).resolves.toEqual({
      failure: { terminal: false, errorCode: 'FIXTURE_500' }
    });
    expect(recordFailure).toHaveBeenCalledWith(postCallJob, error, 25);
    expect(fail).toHaveBeenCalledWith(postCallJob, error);
  });

  it('does not leave a PostCallJob processing when telemetry persistence fails', async () => {
    const telemetryError = new Error('TELEMETRY_WRITE_FAILED');
    const recordFailure = vi.fn().mockRejectedValue(telemetryError);
    const fail = vi.fn().mockResolvedValue({ terminal: true, errorCode: 'FIXTURE_500' });
    const processor: Pick<PostCallProcessor, 'recordFailure'> = { recordFailure };
    const repository: Pick<PostCallJobRepository, 'fail'> = { fail };

    await expect(
      failPostCallJob(
        repository,
        processor,
        { ...postCallJob, attempts: 3 },
        new Error('FIXTURE_500'),
        50
      )
    ).resolves.toEqual({
      failure: { terminal: true, errorCode: 'FIXTURE_500' },
      telemetryFailure: { error: telemetryError }
    });
    expect(fail).toHaveBeenCalledOnce();
  });
});
