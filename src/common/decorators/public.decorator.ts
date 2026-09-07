import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * ยกเว้น endpoint นี้จาก JwtAuthGuard ที่ผูกไว้ระดับ global
 *
 * ระบบตั้งค่าให้ "ต้องล็อกอินเสมอ" เป็นค่าเริ่มต้น endpoint ที่เข้าถึงได้
 * โดยไม่ต้องมี token จึงต้องประกาศออกมาให้ชัดทีละตัว ไม่ใช่ลืมใส่ guard แล้วหลุด
 *
 * ใช้กับ POST /auth/login, POST /auth/refresh และ GET /health เท่านั้น
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
