import type { UserDto } from '@morubi/contracts';

export interface SessionResolver {
  resolve(headers: Headers): Promise<UserDto | null>;
}
