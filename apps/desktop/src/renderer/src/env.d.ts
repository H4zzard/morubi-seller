import type { MorubiBridge } from '../../shared/ipc';

declare global {
  interface Window {
    morubi: MorubiBridge;
  }
}

export {};
