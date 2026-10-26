import { describe, expect, it, vi } from 'vitest';
import {
  BackgroundAppLifecycle,
  type BackgroundApplication,
  type BackgroundWindow
} from './background-app-lifecycle.js';

function harness() {
  let visible = true;
  const quit = vi.fn();
  const setLoginItemSettings = vi.fn();
  const focus = vi.fn();
  const hide = vi.fn(() => {
    visible = false;
  });
  const show = vi.fn(() => {
    visible = true;
  });
  const application: BackgroundApplication = {
    quit,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings
  };
  const window: BackgroundWindow = {
    focus,
    hide,
    isDestroyed: () => false,
    isVisible: () => visible,
    show
  };
  const cleanup = vi.fn(() => Promise.resolve());
  return {
    application,
    cleanup,
    focus,
    hide,
    lifecycle: new BackgroundAppLifecycle(application, window, cleanup),
    quit,
    setLoginItemSettings,
    show
  };
}

describe('BackgroundAppLifecycle', () => {
  it('hides without cleaning up an authorized capture on a normal window close', () => {
    const { cleanup, hide, lifecycle, quit } = harness();
    const event = { preventDefault: vi.fn() };
    expect(lifecycle.handleWindowClose(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('shows and hides through the shared tray lifecycle', () => {
    const { focus, hide, lifecycle, show } = harness();
    lifecycle.toggleWindow();
    expect(hide).toHaveBeenCalledOnce();
    lifecycle.toggleWindow();
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('offers native login startup without enabling it implicitly', () => {
    const { lifecycle, setLoginItemSettings } = harness();
    expect(lifecycle.openAtLogin()).toBe(false);
    lifecycle.setOpenAtLogin(true, 'win32');
    expect(setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ['--background']
    });
    lifecycle.setOpenAtLogin(false, 'darwin');
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false });
  });

  it('deduplicates cleanup and only authorizes quit after resources are released', async () => {
    const { cleanup, lifecycle, quit } = harness();
    const event = { preventDefault: vi.fn() };
    lifecycle.handleBeforeQuit(event);
    await Promise.all([lifecycle.requestQuit(), lifecycle.requestQuit()]);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });
});
