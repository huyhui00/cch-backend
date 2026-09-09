import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { SUPER_ADMIN_ONLY_PERMISSIONS } from '../../common/decorators/require-permission.decorator';
import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import { Permission, Role, RolePermission, UserRole } from '../../models';
import { CreateRoleDto, UpdateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import {
  type PermissionGroupDto,
  type RoleDetailDto,
  type RoleSummaryDto,
  toPermissionItem,
  toRoleDetail,
  toRoleSummary,
} from './dto/role.response';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set(['id', 'name', 'createdAt', 'updatedAt']);

/** include ที่ใช้ซ้ำทุกครั้งที่ต้องคืนสิทธิ์ของบทบาทออกไปด้วย */
const PERMISSIONS_INCLUDE = {
  model: Permission,
  attributes: ['id', 'code', 'module', 'action', 'description'],
  through: { attributes: [] },
  required: false,
};

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    @InjectModel(UserRole) private readonly userRoleModel: typeof UserRole,
    @InjectModel(RolePermission) private readonly rolePermissionModel: typeof RolePermission,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  /**
   * รายการบทบาทสำหรับดรอปดาวน์ "มอบบทบาทให้ผู้ใช้"
   *
   * แยกจาก `findAll()` เพราะสองอย่างนี้ตอบคนละคำถาม — `GET /api/roles` คือหน้าจอ
   * จัดการบทบาท สงวนให้ SUPER_ADMIN ตาม BR-10 ส่วนอันนี้คือ picker ที่ ADMIN ต้องใช้
   * เพราะตาราง CLAUDE.md 4.1 ให้ ADMIN "มอบ Role ให้ user" ได้ ถ้าไม่มีเส้นนี้
   * ADMIN จะมีสิทธิ์มอบบทบาทแต่มองไม่เห็นว่ามีบทบาทอะไรให้เลือก ซึ่งเท่ากับมอบไม่ได้จริง
   *
   * คืนเฉพาะ id / ชื่อ / คำอธิบาย — **ห้ามเพิ่มรายการสิทธิ์ที่ติ๊กไว้ลงมาในนี้**
   * เพราะ "ดูว่าบทบาทนั้นมีสิทธิ์อะไรบ้าง" เป็นของหน้าจอจัดการบทบาทที่สงวนไว้ให้
   * SUPER_ADMIN ถ้าเพิ่มเข้ามา เส้นนี้จะกลายเป็น GET /api/roles ที่ข้าม BR-10 ได้
   *
   * กรองเฉพาะบทบาทที่ยังเปิดใช้งาน ให้ตรงกับที่ `UsersService.resolveRoleIds()`
   * ยอมรับจริง — ไม่งั้นผู้ใช้จะเลือกบทบาทที่ปิดอยู่ได้แล้วโดนปฏิเสธตอนกดบันทึก
   * ไม่แบ่งหน้าเพราะบริษัทขนาดนี้มีบทบาทไม่กี่รายการ
   */
  async findAssignable(): Promise<RoleSummaryDto[]> {
    const roles = await this.roleModel.findAll({
      attributes: ['id', 'name', 'description'],
      where: { isActive: true },
      order: [
        ['name', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    return roles.map(toRoleSummary);
  }

  async findAll(query: QueryRolesDto): Promise<PaginatedResult<RoleDetailDto>> {
    const where: WhereOptions<Role> = {};

    if (query.search) {
      Object.assign(where, {
        [Op.or]: [
          { name: { [Op.like]: '%' + query.search + '%' } },
          { description: { [Op.like]: '%' + query.search + '%' } },
        ],
      });
    }

    if (query.isActive !== undefined) {
      Object.assign(where, { isActive: query.isActive });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'name';

    const { rows, count } = await this.roleModel.findAndCountAll({
      where,
      include: [PERMISSIONS_INCLUDE],
      // จำเป็นเมื่อมี include แบบ M:N ไม่งั้น count จะนับแถวหลัง join ไม่ใช่จำนวนบทบาท
      distinct: true,
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    const userCounts = await this.countUsersByRole(rows.map((role) => role.id));

    return toPaginatedResult(
      rows.map((role) => toRoleDetail(role, userCounts.get(role.id) ?? 0)),
      count,
      query,
    );
  }

  async create(dto: CreateRoleDto, actorId: number): Promise<RoleDetailDto> {
    await this.assertNameIsAvailable(dto.name);

    const permissionIds = await this.resolvePermissionIds(dto.permissionIds ?? []);

    const roleId = await this.sequelize.transaction(async (transaction) => {
      const role = await this.roleModel.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          isActive: dto.isActive ?? true,
          // is_system สงวนไว้ให้ seeder เท่านั้น บทบาทที่สร้างผ่าน API ลบได้เสมอ
          isSystem: false,
          createdBy: actorId,
          updatedBy: actorId,
        },
        { transaction },
      );

      await this.replacePermissions(role.id, permissionIds, actorId, transaction);

      return role.id;
    });

    return this.findDetailOrFail(roleId);
  }

  async update(id: number, dto: UpdateRoleDto, actorId: number): Promise<RoleDetailDto> {
    const role = await this.findOrFail(id);

    if (dto.name !== undefined && dto.name !== role.name) {
      await this.assertNameIsAvailable(dto.name, id);
    }

    // null = ไม่ได้ส่ง permissionIds มา จึงไม่แตะสิทธิ์เดิม
    // ต่างจาก [] ที่แปลว่าให้ถอดสิทธิ์ออกทั้งหมด
    const permissionIds =
      dto.permissionIds === undefined ? null : await this.resolvePermissionIds(dto.permissionIds);

    await this.sequelize.transaction(async (transaction) => {
      await role.update(
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: actorId,
        },
        { transaction },
      );

      if (permissionIds !== null) {
        await this.replacePermissions(id, permissionIds, actorId, transaction);
      }
    });

    return this.findDetailOrFail(id);
  }

  /**
   * ติ๊กสิทธิ์รายเมนู — ค่าที่ส่งมาแทนที่ของเดิมทั้งชุด
   * ล้างแล้วเขียนใหม่ในทรานแซกชันเดียว จะได้ไม่มีจังหวะที่บทบาทไม่มีสิทธิ์เลย
   */
  async setPermissions(
    id: number,
    dto: SetRolePermissionsDto,
    actorId: number,
  ): Promise<RoleDetailDto> {
    await this.findOrFail(id);

    const permissionIds = await this.resolvePermissionIds(dto.permissionIds);

    await this.sequelize.transaction(async (transaction) => {
      await this.replacePermissions(id, permissionIds, actorId, transaction);
      await this.roleModel.update({ updatedBy: actorId }, { where: { id }, transaction });
    });

    return this.findDetailOrFail(id);
  }

  async remove(id: number, actorId: number): Promise<void> {
    const role = await this.findOrFail(id);

    if (role.isSystem) {
      throw new BadRequestException('บทบาทนี้เป็นบทบาทของระบบ ไม่สามารถลบได้');
    }

    // ถ้ายังมีคนถืออยู่แล้วลบทิ้ง แถวใน user_roles จะชี้ไปยังบทบาทที่หายไป
    // เพราะ soft delete ไม่ทำ cascade ให้ จึงบังคับให้ถอดคนออกก่อน
    const holders = await this.userRoleModel.count({ where: { roleId: id } });

    if (holders > 0) {
      throw new BadRequestException(
        'ยังมีผู้ใช้ ' + holders + ' คนถือบทบาทนี้อยู่ กรุณาถอดบทบาทออกจากผู้ใช้ก่อนจึงจะลบได้',
      );
    }

    await this.sequelize.transaction(async (transaction) => {
      await role.update({ deletedBy: actorId }, { transaction });
      await role.destroy({ transaction });
    });
  }

  /** รายการสิทธิ์ทั้งหมด จัดกลุ่มตาม module มาให้พร้อมวาดหน้าติ๊กสิทธิ์ */
  async findAllPermissions(): Promise<PermissionGroupDto[]> {
    const permissions = await this.permissionModel.findAll({
      order: [
        ['module', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const groups = new Map<string, PermissionGroupDto>();

    for (const permission of permissions) {
      const group = groups.get(permission.module) ?? { module: permission.module, permissions: [] };
      group.permissions.push(toPermissionItem(permission));
      groups.set(permission.module, group);
    }

    return [...groups.values()];
  }

  // ---- helpers -------------------------------------------------------------

  private async findOrFail(id: number): Promise<Role> {
    const role = await this.roleModel.findByPk(id);

    if (!role) {
      throw new NotFoundException('ไม่พบข้อมูลบทบาท');
    }

    return role;
  }

  private async findDetailOrFail(id: number): Promise<RoleDetailDto> {
    const role = await this.roleModel.findByPk(id, { include: [PERMISSIONS_INCLUDE] });

    if (!role) {
      throw new NotFoundException('ไม่พบข้อมูลบทบาท');
    }

    const userCount = await this.userRoleModel.count({ where: { roleId: id } });

    return toRoleDetail(role, userCount);
  }

  /**
   * ชื่อบทบาทต้องไม่ซ้ำ — ตรวจรวมบทบาทที่ถูก soft delete ไปแล้วด้วย (paranoid: false)
   * เพราะ unique index ในฐานข้อมูลไม่สนใจ deleted_at ถ้าไม่ตรวจตรงนี้จะไปพังที่ระดับ DB
   */
  private async assertNameIsAvailable(name: string, excludeId?: number): Promise<void> {
    const where: WhereOptions<Role> = excludeId ? { name, id: { [Op.ne]: excludeId } } : { name };

    const existing = await this.roleModel.findOne({ where, paranoid: false });

    if (existing) {
      throw new ConflictException('มีบทบาทชื่อนี้อยู่แล้ว');
    }
  }

  /**
   * ตรวจว่า id ที่ส่งมามีอยู่จริงทุกตัว และไม่ใช่สิทธิ์ที่ผูกกับ account_type
   * ปฏิเสธ role.manage ตั้งแต่ตรงนี้ ดีกว่าปล่อยให้ติ๊กได้แล้วไม่มีผลจริง (BR-10)
   */
  private async resolvePermissionIds(ids: number[]): Promise<number[]> {
    if (ids.length === 0) {
      return [];
    }

    const permissions = await this.permissionModel.findAll({
      attributes: ['id', 'code'],
      where: { id: ids },
    });

    if (permissions.length !== ids.length) {
      const found = new Set(permissions.map((permission) => permission.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new BadRequestException('ไม่พบสิทธิ์ที่ระบุ: ' + missing.join(', '));
    }

    const restricted = permissions.filter((permission) =>
      SUPER_ADMIN_ONLY_PERMISSIONS.has(permission.code),
    );

    if (restricted.length > 0) {
      const codes = restricted.map((permission) => permission.code).join(', ');
      throw new BadRequestException(
        'สิทธิ์ ' + codes + ' ผูกกับบัญชีระดับ SUPER_ADMIN เท่านั้น ไม่สามารถติ๊กให้บทบาทได้',
      );
    }

    return ids;
  }

  private async replacePermissions(
    roleId: number,
    permissionIds: number[],
    actorId: number,
    transaction: Transaction,
  ): Promise<void> {
    await this.rolePermissionModel.destroy({ where: { roleId }, transaction });

    if (permissionIds.length === 0) {
      return;
    }

    await this.rolePermissionModel.bulkCreate(
      permissionIds.map((permissionId) => ({ roleId, permissionId, createdBy: actorId })),
      { transaction },
    );
  }

  /**
   * ดึงเฉพาะคอลัมน์ role_id มานับฝั่ง JS แทนการ GROUP BY
   * user_roles มีขนาดเล็ก (จำนวนพนักงาน x บทบาทที่ถือ) และวิธีนี้ไม่ต้อง cast
   * ผลลัพธ์ raw ที่ Sequelize คืนมาเป็น unknown ให้เสี่ยงพลาดชนิดข้อมูล
   */
  private async countUsersByRole(roleIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();

    if (roleIds.length === 0) {
      return counts;
    }

    const links = await this.userRoleModel.findAll({
      attributes: ['roleId'],
      where: { roleId: roleIds },
    });

    for (const link of links) {
      counts.set(link.roleId, (counts.get(link.roleId) ?? 0) + 1);
    }

    return counts;
  }
}
