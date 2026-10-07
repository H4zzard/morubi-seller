import type { BrowserWindow } from 'electron';
import { realtimeEventEnvelopeSchema } from '@morubi/validation';
import { ipcChannels } from '../shared/ipc.js';
import type { DesktopApiClient } from './desktop-api-client.js';

export function extractSseData(buffer: string): { events: string[]; remainder: string } {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n');
  const remainder = blocks.pop() ?? '';
  const events = blocks
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
    )
    .filter(Boolean);
  return { events, remainder };
}

export class DesktopRealtimeClient {
  private controller: AbortController | null = null;
  private running = false;
  private lastEventId: string | null = null;

  public constructor(
    private readonly window: BrowserWindow,
    private readonly api: DesktopApiClient
  ) {}

  public start(): void {
    if (this.running) return;
    this.running = true;
    void this.connectLoop();
  }

  public stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private async connectLoop(): Promise<void> {
    let backoffMs = 1_000;
    while (this.running && !this.window.isDestroyed()) {
      this.controller = new AbortController();
      try {
        const response = await this.api.realtime(this.lastEventId, this.controller.signal);
        if (!response.ok || !response.body) throw new Error(`REALTIME_HTTP_${response.status}`);
        backoffMs = 1_000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (this.running) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = extractSseData(buffer);
          buffer = parsed.remainder;
          for (const value of parsed.events) {
            const envelope = realtimeEventEnvelopeSchema.safeParse(JSON.parse(value));
            if (!envelope.success) continue;
            this.lastEventId = envelope.data.id;
            this.window.webContents.send(ipcChannels.realtimeEvent, envelope.data);
          }
        }
      } catch (error) {
        if (!this.running || (error instanceof Error && error.name === 'AbortError')) return;
      }
      if (!this.running) return;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(30_000, backoffMs * 2);
    }
  }
}
