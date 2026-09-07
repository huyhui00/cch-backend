import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AccountType } from '../../models';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PERMISSION_KEY,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from '../decorators/require-permission.decorator';
import { AccessControlService } from '../services/access-control.service';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * ตรวจสิทธิ์ตาม CLAUDE.md 9.4
 *
 *   1. SUPER_ADMIN  → ผ่านทุกอย่าง ไม่ต้องผูก role และไม่ query DB เลย
 *   2. role.manage  → เฉพาะ SUPER_ADMIN เท่านั้น ADMIN ก็ไม่ได้ (BR-10)
 *   3. นอกนั้น      → union สิทธิ์จากทุก role ของผู้ใช้ แล้วเทียบกับที่ต้องการ
 *
 * ทำงานหลัง JwtAuthGuard เสมอ (ลำดับตามที่ประกาศใน APP_GUARD)
 * endpoint ที่ไม่ได้ติด @RequirePermission จะผ่านตัวนี้ไปโดยยังต้องล็อกอินอยู่
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อนใช้งาน');
    }

    // 1. SUPER_ADMIN ผ่านทุกอย่าง (CLAUDE.md 4.1)
    if (user.accountType === AccountType.SUPER_ADMIN) {
      return true;
    }

    // 2. สิทธิ์ที่ผูกกับ account_type ไม่ใช่กับ role — ติ๊กให้ยังไงก็ไม่ผ่าน (BR-10)
    //    ตรวจก่อน query DB เพราะคำตอบไม่ขึ้นกับ role ที่ถืออยู่เลย
    if (required.some((code) => SUPER_ADMIN_ONLY_PERMISSIONS.has(code))) {
      throw new ForbiddenException('เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้');
    }

    // 3. union ของทุก role ที่ผู้ใช้ถืออยู่ (CLAUDE.md 4.2)
    const granted = await this.accessControl.findPermissionCodes(user.id);

    if (!required.some((code) => granted.has(code))) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงส่วนนี้');
    }

    return true;
  }
}
