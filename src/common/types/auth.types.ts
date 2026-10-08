import type { AccountType } from '../../models';

export interface AuthenticatedUser {
  id: number;
  username: string;
  accountType: AccountType;
  /** null = token รุ่นก่อนมี user_sessions (CLAUDE.md 4.4) */
  sessionId?: number | null;
}

export interface JwtPayload {
  sub: number;
  username: string;
  accountType: AccountType;
  sid?: number;
}
