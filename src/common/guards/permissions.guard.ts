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
import { ACCOUNT_TYPE_KEY } from '../decorators/require-account-type.decorator';
import {
  PERMISSION_KEY,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from '../decorators/require-permission.decorator';
import { AccessControlService } from '../services/access-control.service';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * ตรวจสิทธิ์ตาม CLAUDE.md 4.1
 *
 *   SUPER_ADMIN  ผ่านทุกอย่าง + เป็นระดับเดียวที่สร้าง/แก้/ลบ Role และกำหนดสิทธิ์ให้ Role ได้
 *   ADMIN        ผ่านทุกเมนู แต่แก้ Role ไม่ได้ และเลื่อนตัวเองเป็น SUPER_ADMIN ไม่ได้
 *   USER         เข้าได้เฉพาะสิ่งที่ Role ที่ได้รับมอบหมายอนุญาต
 *
 * ลำดับการตรวจสำคัญมาก — role.manage ต้องถูกตรวจ "ก่อน" ที่ ADMIN จะได้ bypass
 * ไม่งั้น ADMIN จะหลุดเข้าไปจัดการ Role ได้ ซึ่งขัด BR-10 โดยตรง
 * นี่เป็นเหตุผลที่ ADMIN bypass ไม่ได้อยู่บรรทัดเดียวกับ SUPER_ADMIN
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, targets) ?? [];
    const requiredAccountTypes =
      this.reflector.getAllAndOverride<AccountType[]>(ACCOUNT_TYPE_KEY, targets) ?? [];

    if (requiredPermissions.length === 0 && requiredAccountTypes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อนใช้งาน');
    }

    if (user.accountType === AccountType.SUPER_ADMIN) {
      return true;
    }

    // 2. สิทธิ์ที่ผูกกับ account_type ไม่ใช่กับ Role — ติ๊กให้ Role ยังไงก็ไม่ผ่าน (BR-10)
    //    ต้องอยู่เหนือ ADMIN bypass ข้างล่าง ไม่งั้น ADMIN จะแก้ Role ได้
    if (requiredPermissions.some((code) => SUPER_ADMIN_ONLY_PERMISSIONS.has(code))) {
      throw new ForbiddenException('เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการส่วนนี้ได้');
    }

    if (requiredAccountTypes.length > 0 && !requiredAccountTypes.includes(user.accountType)) {
      throw new ForbiddenException('เฉพาะผู้ดูแลระบบเท่านั้นที่เข้าถึงส่วนนี้ได้');
    }

    if (user.accountType === AccountType.ADMIN) {
      return true;
    }

    if (requiredPermissions.length === 0) {
      return true;
    }

    const granted = await this.accessControl.findPermissionCodes(user.id);

    if (!requiredPermissions.some((code) => granted.has(code))) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงส่วนนี้');
    }

    return true;
  }
}
