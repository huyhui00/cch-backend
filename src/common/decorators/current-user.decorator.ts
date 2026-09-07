import { ExecutionContext, UnauthorizedException, createParamDecorator } from '@nestjs/common';

import type { AuthenticatedUser } from '../types/auth.types';

/**
 * ดึงผู้ใช้ที่ล็อกอินอยู่จาก request ที่ JwtStrategy แนบไว้ให้
 *
 *   @CurrentUser() user: AuthenticatedUser
 *   @CurrentUser('id') userId: number
 *
 * ทุก action ต้องบันทึกผู้กระทำ (BR-09) — service จึงควรรับค่านี้เข้าไป
 * เพื่อเติม created_by / updated_by เสมอ
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    // เกิดได้เฉพาะตอนเผลอใช้ decorator นี้บน endpoint ที่ติด @Public()
    if (!user) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อนใช้งาน');
    }

    return field ? user[field] : user;
  },
);
