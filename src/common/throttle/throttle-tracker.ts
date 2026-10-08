import { JwtService } from '@nestjs/jwt';
import type { ThrottlerGenerateKeyFunction, ThrottlerGetTrackerFunction } from '@nestjs/throttler';

import type { JwtPayload } from '../types/auth.types';

export const IP_TRACKER_PREFIX = 'ip:';
export const USER_TRACKER_PREFIX = 'user:';

export const ipTracker: ThrottlerGetTrackerFunction = (req) => `${IP_TRACKER_PREFIX}${req.ip}`;

/**
 * คำขอที่มี access token ถูกต้องนับต่อผู้ใช้ นอกนั้นนับต่อ IP
 *
 * ทั้งออฟฟิศมักออกเน็ตด้วย IP เดียว ถ้านับต่อ IP อย่างเดียว พนักงานทุกคนจะใช้เพดานร่วมกัน
 * ต้องตรวจลายเซ็นก่อนเชื่อ `sub` — ไม่งั้นปลอม token ใส่ `sub` สุ่มก็ได้ถังใหม่ทุกคำขอ หนีเพดานได้
 * guard นี้ทำงานก่อน JwtAuthGuard จึงยังไม่มี `request.user` ให้อ่าน
 */
export function createUserOrIpTracker(accessSecret: string): ThrottlerGetTrackerFunction {
  const jwt = new JwtService();

  return (req) => {
    const headers = req.headers as Record<string, unknown> | undefined;
    const header = headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify<JwtPayload>(header.slice(7), { secret: accessSecret });
        if (payload?.sub) {
          return `${USER_TRACKER_PREFIX}${payload.sub}`;
        }
      } catch {
        // token หมดอายุหรือปลอม — นับต่อ IP แทน
      }
    }
    return ipTracker(req, undefined as never);
  };
}

export const sharedBucketKey: ThrottlerGenerateKeyFunction = (_context, tracker, name) =>
  `${name}:${tracker}`;

/** ถังของเส้นล็อกอินแยกจากถังรวม ไม่งั้นคำขออื่นจาก IP เดียวกันจะกินเพดานล็อกอิน */
export const loginBucketKey: ThrottlerGenerateKeyFunction = (_context, tracker, name) =>
  `login:${name}:${tracker}`;
