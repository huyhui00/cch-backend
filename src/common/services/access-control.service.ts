import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { AccountType, Permission, Role, User } from '../../models';
import { SUPER_ADMIN_ONLY_PERMISSIONS } from '../decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../types/auth.types';

/**
 * แหล่งความจริงเดียวของ "ผู้ใช้คนนี้มีสิทธิ์อะไรบ้าง"
 *
 * ใช้ทั้งใน PermissionsGuard ตอนตัดสินใจอนุญาต และใน GET /api/auth/me
 * ตอนส่งรายการสิทธิ์ให้ frontend เอาไปซ่อน/แสดงเมนู ทั้งสองทางต้องได้คำตอบ
 * ชุดเดียวกันเสมอ ไม่งั้นเมนูที่มองเห็นกับสิ่งที่กดได้จริงจะไม่ตรงกัน
 *
 * ไม่มี cache โดยเจตนา — CLAUDE.md กำหนดให้ query ตอน guard ทำงาน
 * เพื่อให้การถอด role หรือปิด role มีผลกับ token ที่ออกไปแล้วทันที
 */
@Injectable()
export class AccessControlService {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

  async findRolesWithPermissions(userId: number): Promise<Role[]> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id'],
      include: [
        {
          model: Role,
          attributes: ['id', 'name', 'description'],
          through: { attributes: [] },
          required: false,
          where: { isActive: true },
          include: [
            {
              model: Permission,
              attributes: ['id', 'code', 'module', 'action'],
              through: { attributes: [] },
              required: false,
            },
          ],
        },
      ],
    });

    return user?.roles ?? [];
  }

  async findPermissionCodes(userId: number): Promise<Set<string>> {
    const roles = await this.findRolesWithPermissions(userId);
    const codes = new Set<string>();

    for (const role of roles) {
      for (const permission of role.permissions ?? []) {
        codes.add(permission.code);
      }
    }

    return codes;
  }

  /**
   * ผู้ใช้คนนี้ทำสิ่งที่ต้องใช้สิทธิ์ `code` ได้ไหม — ตัดสินแบบเดียวกับ PermissionsGuard ข้อ 1, 2, 4, 5
   *
   * มีไว้สำหรับจุดที่สิทธิ์ขึ้นกับ *เนื้อหา* ของคำขอ ซึ่ง decorator บน endpoint ตรวจแทนไม่ได้
   * เช่น `POST /api/projects` ที่ส่ง `newCustomer` มาด้วย ต้องมี `customer.create` เพิ่มจาก
   * `project.create` ไม่งั้นเส้นนี้จะกลายเป็นทางอ้อมให้คนที่ไม่มีสิทธิ์เพิ่มลูกค้าได้
   */
  async hasPermission(user: AuthenticatedUser, code: string): Promise<boolean> {
    if (user.accountType === AccountType.SUPER_ADMIN) {
      return true;
    }

    // ต้องอยู่เหนือ ADMIN bypass เหมือนใน guard (BR-10)
    if (SUPER_ADMIN_ONLY_PERMISSIONS.has(code)) {
      return false;
    }

    if (user.accountType === AccountType.ADMIN) {
      return true;
    }

    return (await this.findPermissionCodes(user.id)).has(code);
  }
}
