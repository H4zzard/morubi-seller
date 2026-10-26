import { parseDesktopEnv, type DesktopEnv } from '@morubi/config';

export function parseDesktopRuntimeEnv(
  input: NodeJS.ProcessEnv,
  isPackaged: boolean
): DesktopEnv {
  return parseDesktopEnv({
    ...input,
    ...(isPackaged && input.MORUBI_LIVE_CAPTURE_ENABLED === undefined
      ? { MORUBI_LIVE_CAPTURE_ENABLED: 'true' }
      : {})
  });
}
