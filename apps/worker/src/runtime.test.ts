import { describe, expect, it, vi } from 'vitest';
import { WorkerRuntime } from './runtime.js';

describe('dedicated worker runtime', () => {
  it('waits for the active cycle during graceful shutdown', async () => {
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cycle = vi.fn(() => active);
    const runtime = new WorkerRuntime(cycle, 10);
    const running = runtime.start();
    await vi.waitFor(() => expect(cycle).toHaveBeenCalledOnce());
    const stopping = runtime.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    await running;
    expect(cycle).toHaveBeenCalledOnce();
  });
});
