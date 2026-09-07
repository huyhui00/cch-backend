import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { Permission, Role, User } from '../../models';

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

  /**
   * role ทั้งหมดของผู้ใช้พร้อม permission ของแต่ละ role
   *
   * นับเฉพาะ role ที่ is_active = true — role ที่ถูกปิดไว้ยังผูกกับผู้ใช้อยู่
   * แต่ไม่ให้สิทธิ์ ส่วน role ที่ถูก soft delete แล้ว paranoid ตัดออกให้เอง
   */
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

  /**
   * สิทธิ์ทั้งหมดของผู้ใช้ = union ของทุก role ที่ถืออยู่ (CLAUDE.md 4.2)
   * เคสจริงคือพนักงานคนหนึ่งทำทั้ง Support และ Marketing จึงได้สิทธิ์ทั้งสองฝั่งรวมกัน
   */
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
}
