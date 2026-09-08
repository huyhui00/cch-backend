import { AsyncLocalStorage } from 'node:async_hooks';

import type { NextFunction, Request, Response } from 'express';

/**
 * ข้อมูลของ request ที่กำลังทำงานอยู่ ณ ขณะนั้น
 *
 * ตัว object ถูกสร้างครั้งเดียวตอนต้น request แล้วส่งต่อ "โดยอ้างอิง"
 * จึงแก้ค่า userId ทีหลังได้ หลังจาก guard ยืนยันตัวตนเสร็จ
 */
export interface RequestContext {
  userId: number | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * หัวใจของ Phase นี้ — AsyncLocalStorage เก็บค่าไว้ผูกกับ "สายการทำงานแบบ async"
 * ไม่ใช่ผูกกับตัวแปร global
 *
 * โค้ดที่ถูกเรียกลึกลงไปเท่าไรก็ตามภายใน callback ของ storage.run() จะเห็นค่าเดียวกัน
 * แม้จะผ่าน await กี่ชั้นก็ตาม และ request คนละใบที่วิ่งพร้อมกันจะไม่เห็นค่าของกันและกัน
 * นี่คือเหตุผลที่ Sequelize hook ซึ่งไม่มีทางรู้จัก HTTP request เลย ยังรู้ได้ว่าใครเป็นคนสั่ง
 */
const storage = new AsyncLocalStorage<RequestContext>();

/** คืน undefined เมื่อถูกเรียกนอก request เช่นจาก scheduler หรือ seeder */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** ผู้กระทำของ action ปัจจุบัน — null เมื่อระบบเป็นผู้ทำเอง (BR-09 ยอมให้ null ได้) */
export function getCurrentUserId(): number | null {
  return storage.getStore()?.userId ?? null;
}

export function setCurrentUserId(userId: number | null): void {
  const store = storage.getStore();

  if (store) {
    store.userId = userId;
  }
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** ความยาวสูงสุดตามคอลัมน์ใน audit_logs */
const MAX_IP_LENGTH = 45;
const MAX_USER_AGENT_LENGTH = 500;

/**
 * Express middleware ที่เปิด context ให้ทั้ง request
 *
 * ต้องเป็น middleware ไม่ใช่ interceptor เพราะ middleware ทำงานก่อนสุดในสาย
 * ทุกอย่างที่เกิดหลังจากนี้ (guard, interceptor, controller, service, hook)
 * จึงอยู่ภายใน callback เดียวกันทั้งหมด
 *
 * ตอนนี้ยังไม่รู้ว่า user เป็นใคร เพราะ guard ยังไม่ทำงาน จึงตั้ง userId เป็น null ไว้ก่อน
 * แล้วให้ RequestContextInterceptor มาเติมให้ทีหลัง
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const context: RequestContext = {
    userId: null,
    ipAddress: truncate(req.ip ?? req.socket.remoteAddress, MAX_IP_LENGTH),
    userAgent: truncate(req.headers['user-agent'], MAX_USER_AGENT_LENGTH),
  };

  runWithRequestContext(context, next);
}

function truncate(value: string | undefined, max: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? value.slice(0, max) : value;
}
