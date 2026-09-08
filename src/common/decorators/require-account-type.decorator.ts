import { SetMetadata } from '@nestjs/common';

import type { AccountType } from '../../models';

export const ACCOUNT_TYPE_KEY = 'requiredAccountTypes';

/**
 * จำกัดการเข้าถึงด้วย "ระดับบัญชี" ไม่ใช่ด้วยสิทธิ์ที่ติ๊กให้บทบาท
 *
 *   @RequireAccountType(AccountType.ADMIN)   // SUPER_ADMIN กับ ADMIN เท่านั้น
 *
 * ต่างจาก @RequirePermission ตรงที่ผูกกับ users.account_type โดยตรง ผู้ใช้ระดับ USER
 * จึงเข้าไม่ได้ไม่ว่าจะถูกติ๊กสิทธิ์อะไรให้ก็ตาม เหมาะกับหน้าจอที่ CLAUDE.md ระบุ
 * ระดับบัญชีไว้ตรง ๆ เช่นหน้าประวัติการใช้งาน
 *
 * SUPER_ADMIN ผ่านเสมอโดยไม่ต้องระบุในรายการ เพราะ bypass ทุกอย่างอยู่แล้ว (CLAUDE.md 4.1)
 * ใช้ร่วมกับ @RequirePermission ได้ กรณีนั้นต้องผ่านทั้งสองเงื่อนไข
 */
export const RequireAccountType = (...accountTypes: AccountType[]) =>
  SetMetadata(ACCOUNT_TYPE_KEY, accountTypes);
