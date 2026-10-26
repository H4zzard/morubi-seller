import { describe, expect, it } from 'vitest';
import {
  MacOSAudioDeviceInventoryProvider,
  macOSBlackHoleSourceId,
  parseMacOSSystemAudioSources
} from './macos-audio-devices.js';

describe('macOS system audio inventory', () => {
  it('detects only an input named BlackHole 2ch', () => {
    expect(
      parseMacOSSystemAudioSources(
        JSON.stringify({
          SPAudioDataType: [
            {
              _items: [
                { _name: 'Built-in Microphone', coreaudio_device_input: 2 },
                { _name: 'BlackHole 2ch', coreaudio_device_input: 2 },
                { _name: 'BlackHole 16ch', coreaudio_device_input: 16 },
                { _name: 'BlackHole 2ch', coreaudio_device_output: 2 }
              ]
            }
          ]
        })
      )
    ).toEqual([
      { id: macOSBlackHoleSourceId, name: 'BlackHole 2ch', kind: 'VIRTUAL_DEVICE' }
    ]);
  });

  it('reports no system source when BlackHole is absent', async () => {
    const provider = new MacOSAudioDeviceInventoryProvider({
      platform: 'darwin',
      runner: () =>
        Promise.resolve(
          JSON.stringify({
            SPAudioDataType: [{ _items: [{ _name: 'Built-in Microphone', coreaudio_device_input: 2 }] }]
          })
        )
    });
    await expect(provider.listSystemAudioSources()).resolves.toEqual([]);
  });

  it('does not execute the macOS inventory on Windows', async () => {
    let calls = 0;
    const provider = new MacOSAudioDeviceInventoryProvider({
      platform: 'win32',
      runner: () => {
        calls += 1;
        return Promise.resolve('{}');
      }
    });
    await expect(provider.listSystemAudioSources()).resolves.toEqual([]);
    expect(calls).toBe(0);
  });
});
