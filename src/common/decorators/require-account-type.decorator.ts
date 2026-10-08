import { SetMetadata } from '@nestjs/common';

import type { AccountType } from '../../models';

export const ACCOUNT_TYPE_KEY = 'requiredAccountTypes';

export const RequireAccountType = (...accountTypes: AccountType[]) =>
  SetMetadata(ACCOUNT_TYPE_KEY, accountTypes);
