import { describe, expect, it, vi } from 'vitest';
import type { LiveCallDetailDto, LiveCallSessionDto } from '@morubi/contracts';
import { LiveCaptureLifecycle } from './live-capture-lifecycle.js';

function activeSession(): LiveCallDetailDto {
  return { id: 'session-1', status: 'ACTIVE' } as LiveCallDetailDto;
}

describe('LiveCaptureLifecycle', () => {
  it('stops renderer capture, revokes authorization, and ends the backend session on logout', async () => {
    const endLiveCall = vi.fn(() => Promise.resolve({ id: 'session-1' } as LiveCallSessionDto));
    const clear = vi.fn();
    const notify = vi.fn();
    const lifecycle = new LiveCaptureLifecycle(
      {
        getCurrentLiveCall: () => Promise.resolve({ session: activeSession() }),
        endLiveCall
      },
      clear,
      notify
    );
    await lifecycle.cleanup();
    expect(notify).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(endLiveCall).toHaveBeenCalledWith('session-1');
  });

  it('cleans a renderer crash without trying to message the dead renderer', async () => {
    const endLiveCall = vi.fn(() => Promise.resolve({ id: 'session-1' } as LiveCallSessionDto));
    const clear = vi.fn();
    const notify = vi.fn();
    const lifecycle = new LiveCaptureLifecycle(
      {
        getCurrentLiveCall: () => Promise.resolve({ session: activeSession() }),
        endLiveCall
      },
      clear,
      notify
    );
    await lifecycle.cleanup({ notifyRenderer: false });
    expect(notify).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
    expect(endLiveCall).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent cleanup and preserves local cleanup when the API is unavailable', async () => {
    const clear = vi.fn();
    const notify = vi.fn();
    const getCurrentLiveCall = vi.fn(() => Promise.reject(new Error('offline')));
    const lifecycle = new LiveCaptureLifecycle(
      { getCurrentLiveCall, endLiveCall: vi.fn() },
      clear,
      notify
    );
    await Promise.all([lifecycle.cleanup(), lifecycle.cleanup()]);
    expect(getCurrentLiveCall).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });
});
