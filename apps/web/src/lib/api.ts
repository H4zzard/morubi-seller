import { ApiClient } from '@morubi/contracts/client';
import { webEnv } from './env';

const organizationStorageKey = 'morubi.activeOrganizationId';

export function getActiveOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(organizationStorageKey);
}

export function setActiveOrganizationId(value: string): void {
  window.localStorage.setItem(organizationStorageKey, value);
}

export function clearActiveOrganizationId(): void {
  window.localStorage.removeItem(organizationStorageKey);
}

export const apiClient = new ApiClient({
  baseUrl: webEnv.NEXT_PUBLIC_API_URL,
  getOrganizationId: getActiveOrganizationId,
  getHeaders: () => ({ 'x-morubi-client': 'web' })
});
