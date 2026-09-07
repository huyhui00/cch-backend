import type { AccountType } from '../../models';

/**
 * สิ่งที่ JwtStrategy แนบไว้ที่ `request.user` หลังตรวจ token ผ่าน
 *
 * เก็บเฉพาะข้อมูลที่ guard ต้องใช้ตัดสินใจ ไม่ยัด permissions ลงมาด้วย
 * เพราะ PermissionsGuard จะ query จาก DB ตอนทำงาน (CLAUDE.md 9.4)
 * ทำให้การถอด role ของ user มีผลทันที ไม่ต้องรอ token หมดอายุ
 */
export interface AuthenticatedUser {
  id: number;
  username: string;
  accountType: AccountType;
}

/**
 * โครงสร้าง payload ของ JWT ทั้ง access และ refresh token
 * ทั้งสองใบใช้รูปแบบเดียวกัน แต่เซ็นด้วยคนละ secret จึงสลับกันใช้ไม่ได้
 */
export interface JwtPayload {
  sub: number;
  username: string;
  accountType: AccountType;
}
