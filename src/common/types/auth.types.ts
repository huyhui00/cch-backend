import type { AccountType } from '../../models';

export interface AuthenticatedUser {
  id: number;
  username: string;
  accountType: AccountType;
}

export interface JwtPayload {
  sub: number;
  username: string;
  accountType: AccountType;
}
