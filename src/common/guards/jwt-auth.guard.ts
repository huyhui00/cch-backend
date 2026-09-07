import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * ตรวจ access token จาก header `Authorization: Bearer <token>`
 * งานตรวจลายเซ็นและโหลดผู้ใช้อยู่ใน JwtStrategy ตัว guard นี้ทำแค่
 * เปิดทางให้ endpoint ที่ติด @Public() ผ่านไปได้
 *
 * ผูกไว้ที่ระดับ global (APP_GUARD) — endpoint ใหม่ทุกตัวจึงต้องล็อกอิน
 * โดยอัตโนมัติ ลืมใส่ guard แล้วหลุดไม่ได้
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * แทนข้อความอังกฤษของ passport ด้วยภาษาไทย (CLAUDE.md 6.5)
   * ส่วน error ที่ JwtStrategy โยนเอง (เช่น บัญชีถูกระงับ) ให้ผ่านไปตามเดิม
   * เพื่อไม่ให้ข้อความเฉพาะเจาะจงถูกกลืนหาย
   */
  handleRequest<TUser = unknown>(err: unknown, user: unknown): TUser {
    // passport ส่ง err มาเป็น unknown ตามสัญญาของ base class
    // ถ้าเป็น Error อยู่แล้วให้โยนต่อตามเดิม เพื่อไม่ให้ข้อความเฉพาะเจาะจง
    // ที่ JwtStrategy โยนไว้ (เช่น "บัญชีนี้ถูกระงับการใช้งาน") ถูกกลืนหาย
    if (err instanceof Error) {
      throw err;
    }

    if (err || !user) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อนใช้งาน');
    }

    return user as TUser;
  }
}
