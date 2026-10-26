import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MacOSNativeAudioEngine,
  parseMacOSVersion,
  supportsScreenCaptureKitAudio
} from './macos-native-audio-engine.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe('macOS native audio engine', () => {
  it('selects ScreenCaptureKit audio only on macOS 13 or newer', () => {
    expect(parseMacOSVersion('13.7.8')).toEqual({ major: 13, minor: 7, patch: 8 });
    expect(supportsScreenCaptureKitAudio('12.7.6')).toBe(false);
    expect(supportsScreenCaptureKitAudio('13.0')).toBe(true);
    expect(supportsScreenCaptureKitAudio('15.2')).toBe(true);
  });

  it('requires an executable helper and the correct platform', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morubi-native-audio-'));
    temporaryDirectories.push(directory);
    const helperPath = join(directory, 'helper');
    await writeFile(helperPath, '#!/bin/sh\nexit 0\n');
    await chmod(helperPath, 0o755);

    await expect(
      new MacOSNativeAudioEngine({
        helperPath,
        systemVersion: '13.7.8',
        platform: 'darwin'
      }).available()
    ).resolves.toBe(true);
    await expect(
      new MacOSNativeAudioEngine({
        helperPath,
        systemVersion: '12.7.6',
        platform: 'darwin'
      }).available()
    ).resolves.toBe(false);
    await expect(
      new MacOSNativeAudioEngine({
        helperPath,
        systemVersion: '13.7.8',
        platform: 'win32'
      }).available()
    ).resolves.toBe(false);
  });

  it('authenticates, starts and stops the helper with the exact session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morubi-native-audio-'));
    temporaryDirectories.push(directory);
    const helperPath = join(directory, 'helper');
    await writeFile(
      helperPath,
      [
        '#!/bin/sh',
        'IFS= read -r authentication',
        'printf \'{"type":"ready","method":"MACOS_SCREEN_CAPTURE_KIT","sessionId":"%s"}\\n\' "$MORUBI_AUDIO_SESSION_ID"',
        'IFS= read -r stop',
        'exit 0',
        ''
      ].join('\n')
    );
    await chmod(helperPath, 0o755);
    const engine = new MacOSNativeAudioEngine({
      helperPath,
      systemVersion: '13.7.8',
      platform: 'darwin',
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 2_000
    });

    await expect(engine.start('session-1')).resolves.toEqual({
      method: 'MACOS_SCREEN_CAPTURE_KIT',
      deviceLabel: 'Áudio da reunião'
    });
    await expect(engine.start('session-2')).rejects.toThrow(
      'MACOS_NATIVE_SYSTEM_AUDIO_ALREADY_ACTIVE'
    );
    await expect(engine.stop('another-session')).resolves.toBeUndefined();
    await expect(engine.stop('session-1')).resolves.toBeUndefined();
  });
});
