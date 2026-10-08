import { createHash, timingSafeEqual } from 'node:crypto';

import * as bcrypt from 'bcrypt';

export const DEFAULT_SALT_ROUNDS = 10;

export function hashPassword(plain: string, rounds: number = DEFAULT_SALT_ROUNDS): Promise<string> {
  return bcrypt.hash(plain, rounds);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * hash ของ refresh token ที่เก็บลง users.refresh_token_hash
 *
 * ใช้ SHA-256 ไม่ใช่ bcrypt โดยเจตนา — bcrypt ตัด input ทิ้งที่ 72 ไบต์
 * แต่ JWT ยาวเกินนั้นเสมอ ถ้าใช้ bcrypt token คนละใบที่ 72 ไบต์แรกตรงกัน
 * จะกลายเป็นใบเดียวกันในสายตาระบบ ส่วนเหตุผลที่ SHA-256 พอเพียงตรงนี้คือ
 * ตัว token เป็นค่าสุ่มเอนโทรปีสูงอยู่แล้ว ไม่ใช่รหัสผ่านที่คนตั้งเอง
 * จึงไม่ต้องการ key stretching
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
