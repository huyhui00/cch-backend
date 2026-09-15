import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { type PaginatedResult, toPaginatedResult } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { DEFAULT_SALT_ROUNDS, hashPassword, verifyPassword } from '../../common/utils/crypto.util';
import { AccessControlService } from '../../common/services/access-control.service';
import { AccountType, Role, User, UserRole, UserStatus } from '../../models';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { AssignableCapability } from './dto/query-assignable-users.dto';
import { AssignRolesDto, ChangePasswordDto, UpdateUserStatusDto } from './dto/user-actions.dto';
import { type AssignableUserDto, type UserResponseDto, toUserResponse } from './dto/user.response';

/** ฟิลด์ที่ยอมให้เรียงลำดับได้ — กันค่าแปลกปลอมจาก query string sortBy หลุดเข้า ORDER BY */
const SORTABLE_FIELDS = new Set([
  'id',
  'username',
  'fullName',
  'employeeCode',
  'status',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
]);

/** include ที่ใช้ซ้ำทุกครั้งที่ต้องคืน role ของผู้ใช้ออกไปด้วย */
const ROLES_INCLUDE = {
  model: Role,
  attributes: ['id', 'name', 'description'],
  through: { attributes: [] },
  required: false,
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(UserRole) private readonly userRoleModel: typeof UserRole,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly config: ConfigService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * รายชื่อพนักงานสำหรับดรอปดาวน์ "มอบหมายให้ใคร"
   *
   * แยกจาก `findAll()` เพราะสองอย่างนี้ตอบคนละคำถาม — `GET /api/users` คือหน้าจอ
   * จัดการผู้ใช้ ต้องมีสิทธิ์ `user.view` ส่วนอันนี้คือ picker ที่พนักงาน support
   * ซึ่งมีแค่สิทธิ์มอบหมายงานก็ต้องใช้ได้ ถ้าบังคับ `user.view` ด้วย เท่ากับต้องให้
   * สิทธิ์จัดการผู้ใช้เต็มใบกับทุกคนที่มอบหมายงานเป็น ซึ่งกว้างเกินความจำเป็น
   *
   * คืนเฉพาะ id / ชื่อ / ชื่อผู้ใช้ / ตำแหน่ง ของคนที่ยัง ACTIVE เท่านั้น
   * **ห้ามเพิ่มอีเมล สถานะบัญชี ระดับบัญชี หรือบทบาทลงมาในนี้** ข้อมูลพวกนั้นเป็นของ
   * หน้าจอจัดการผู้ใช้ที่มีสิทธิ์กั้นอยู่ ไม่แบ่งหน้าเพราะบริษัทมีพนักงาน 2-20 คน
   *
   * คนที่ลาออกแล้วไม่อยู่ในรายการนี้ เพราะเป็นการ *มอบหมายงานใหม่* ต่างจากการบันทึก
   * ข้อเท็จจริงในอดีตอย่างผู้ส่งมอบใน Phase 6 ที่ระบุคนที่ลาออกแล้วได้
   */
  async findAssignable(capability?: AssignableCapability): Promise<AssignableUserDto[]> {
    const users = await this.userModel.findAll({
      where: { status: UserStatus.ACTIVE },
      attributes: ['id', 'username', 'fullName', 'position'],
      order: [
        ['fullName', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const requiredPermissions = capability
      ? {
          [AssignableCapability.TASK]: ['task.view', 'task.update'],
          [AssignableCapability.TICKET]: ['ticket.view', 'ticket.update', 'ticket.resolve'],
          [AssignableCapability.TASK_REVIEW]: ['task.review'],
        }[capability]
      : [];

    const eligibleUsers =
      requiredPermissions.length === 0
        ? users
        : (
            await Promise.all(
              users.map(async (user) => {
                const allowed = await Promise.all(
                  requiredPermissions.map((permission) =>
                    this.accessControl.hasPermission(user, permission),
                  ),
                );
                return allowed.every(Boolean) ? user : null;
              }),
            )
          ).filter((user): user is (typeof users)[number] => user !== null);

    return eligibleUsers.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      position: user.position,
    }));
  }

  async findAll(query: QueryUsersDto): Promise<PaginatedResult<UserResponseDto>> {
    const where: WhereOptions<User> = {};

    if (query.search) {
      const like = '%' + query.search + '%';
      Object.assign(where, {
        [Op.or]: [
          { username: { [Op.like]: like } },
          { fullName: { [Op.like]: like } },
          { nickname: { [Op.like]: like } },
          { email: { [Op.like]: like } },
          { employeeCode: { [Op.like]: like } },
        ],
      });
    }

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    if (query.accountType) {
      Object.assign(where, { accountType: query.accountType });
    }

    // กรองด้วย role แยกเป็นคนละ query แทนการ join แบบ required
    // เพราะถ้า join ผลลัพธ์ roles ของแต่ละคนจะเหลือแค่ role ที่ใช้กรอง
    // ทั้งที่หน้าจอต้องเห็นทุก role ที่คนนั้นถืออยู่ (CLAUDE.md 4.2)
    if (query.roleId !== undefined) {
      const links = await this.userRoleModel.findAll({
        attributes: ['userId'],
        where: { roleId: query.roleId },
      });

      Object.assign(where, { id: { [Op.in]: links.map((link) => link.userId) } });
    }

    const sortBy = SORTABLE_FIELDS.has(query.sortBy ?? '') ? (query.sortBy as string) : 'createdAt';

    const { rows, count } = await this.userModel.findAndCountAll({
      where,
      include: [ROLES_INCLUDE],
      // จำเป็นเมื่อมี include แบบ M:N ไม่งั้น count จะนับแถวหลัง join ไม่ใช่จำนวนผู้ใช้
      distinct: true,
      order: [[sortBy, query.sortOrder]],
      limit: query.limit,
      offset: query.offset,
    });

    return toPaginatedResult(rows.map(toUserResponse), count, query);
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const accountType = dto.accountType ?? AccountType.USER;

    this.assertCanGrantAccountType(actor, accountType);
    await this.assertIdentifiersAreAvailable(dto);

    const roleIds = await this.resolveRoleIds(dto.roleIds ?? [], accountType);
    const passwordHash = await hashPassword(dto.password, this.saltRounds);

    const userId = await this.sequelize.transaction(async (transaction) => {
      const user = await this.userModel.create(
        {
          username: dto.username,
          passwordHash,
          fullName: dto.fullName,
          employeeCode: dto.employeeCode ?? null,
          email: dto.email ?? null,
          nickname: dto.nickname ?? null,
          phone: dto.phone ?? null,
          position: dto.position ?? null,
          avatarUrl: dto.avatarUrl ?? null,
          lineUserId: dto.lineUserId ?? null,
          accountType,
          status: UserStatus.ACTIVE,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        { transaction },
      );

      await this.replaceRoles(user.id, roleIds, actor.id, transaction);

      return user.id;
    });

    return this.findDetailOrFail(userId);
  }

  async update(id: number, dto: UpdateUserDto, actor: AuthenticatedUser): Promise<UserResponseDto> {
    const user = await this.findOrFail(id);

    this.assertCanManage(actor, user);

    if (dto.accountType !== undefined && dto.accountType !== user.accountType) {
      this.assertCanGrantAccountType(actor, dto.accountType);

      // ลดระดับ SUPER_ADMIN คนสุดท้ายลงมา = ไม่เหลือใครแก้บทบาทได้อีกเลย (BR-10)
      if (user.accountType === AccountType.SUPER_ADMIN) {
        await this.assertNotLastSuperAdmin(user.id);
      }
    }

    await this.assertIdentifiersAreAvailable(dto, id);

    await user.update({
      ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
      ...(dto.employeeCode !== undefined ? { employeeCode: dto.employeeCode ?? null } : {}),
      ...(dto.email !== undefined ? { email: dto.email ?? null } : {}),
      ...(dto.nickname !== undefined ? { nickname: dto.nickname ?? null } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone ?? null } : {}),
      ...(dto.position !== undefined ? { position: dto.position ?? null } : {}),
      ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl ?? null } : {}),
      ...(dto.lineUserId !== undefined ? { lineUserId: dto.lineUserId ?? null } : {}),
      ...(dto.accountType !== undefined ? { accountType: dto.accountType } : {}),
      updatedBy: actor.id,
    });

    return this.findDetailOrFail(id);
  }

  /**
   * ผูกบทบาททั้งชุด — 1 user ถือได้หลาย role พร้อมกัน สิทธิ์เป็น union (CLAUDE.md 4.2)
   * ล้างของเดิมแล้วเขียนใหม่ในทรานแซกชันเดียว จะได้ไม่มีจังหวะที่ผู้ใช้ไม่มีบทบาทเลย
   */
  async assignRoles(
    id: number,
    dto: AssignRolesDto,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.findOrFail(id);

    this.assertCanManage(actor, user);

    const roleIds = await this.resolveRoleIds(dto.roleIds, user.accountType);

    await this.sequelize.transaction(async (transaction) => {
      await this.replaceRoles(id, roleIds, actor.id, transaction);
      await user.update({ updatedBy: actor.id }, { transaction });
    });

    return this.findDetailOrFail(id);
  }

  /**
   * เปลี่ยนสถานะพนักงาน — ใช้แทนการลบผู้ใช้ทิ้ง (BR-09)
   * การเปลี่ยนสถานะไม่กระทบบทบาท บทบาทยังอยู่ในระบบเอาไปใช้กับคนถัดไปได้ (CLAUDE.md 4.3)
   */
  async updateStatus(
    id: number,
    dto: UpdateUserStatusDto,
    actor: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.findOrFail(id);

    this.assertCanManage(actor, user);

    if (user.id === actor.id) {
      throw new BadRequestException('ไม่สามารถเปลี่ยนสถานะบัญชีของตนเองได้');
    }

    if (dto.status !== UserStatus.ACTIVE && user.accountType === AccountType.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(user.id);
    }

    await user.update({
      status: dto.status,
      // ตัด session ที่ค้างอยู่ทันที ไม่ต้องรอ refresh token หมดอายุเอง
      // ส่วน access token ที่ยังไม่หมดอายุถูกกันไว้แล้วที่ JwtStrategy ซึ่งเช็คสถานะทุกครั้ง
      ...(dto.status === UserStatus.ACTIVE ? {} : { refreshTokenHash: null }),
      updatedBy: actor.id,
    });

    return this.findDetailOrFail(id);
  }

  /** เปลี่ยนรหัสผ่านของตัวเองเท่านั้น ไม่ใช่ของคนอื่น */
  async changeOwnPassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.userModel.findByPk(userId);

    if (!user) {
      throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
    }

    const matched = await verifyPassword(dto.currentPassword, user.passwordHash);

    if (!matched) {
      throw new BadRequestException('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    await user.update({
      passwordHash: await hashPassword(dto.newPassword, this.saltRounds),
      // เปลี่ยนรหัสผ่านแล้วต้องล็อกอินใหม่ทุกอุปกรณ์ เผื่อกรณีที่เปลี่ยนเพราะสงสัยว่ารหัสหลุด
      refreshTokenHash: null,
      updatedBy: user.id,
    });
  }

  // ---- helpers -------------------------------------------------------------

  private get saltRounds(): number {
    const rounds = Number(this.config.get('BCRYPT_SALT_ROUNDS'));
    return Number.isInteger(rounds) && rounds > 0 ? rounds : DEFAULT_SALT_ROUNDS;
  }

  private async findOrFail(id: number): Promise<User> {
    const user = await this.userModel.findByPk(id);

    if (!user) {
      throw new NotFoundException('ไม่พบข้อมูลผู้ใช้');
    }

    return user;
  }

  private async findDetailOrFail(id: number): Promise<UserResponseDto> {
    const user = await this.userModel.findByPk(id, { include: [ROLES_INCLUDE] });

    if (!user) {
      throw new NotFoundException('ไม่พบข้อมูลผู้ใช้');
    }

    return toUserResponse(user);
  }

  /**
   * ใครสร้าง/เลื่อนระดับบัญชีระดับไหนได้บ้าง (CLAUDE.md 4.1)
   *   SUPER_ADMIN  สร้างได้ทุกระดับ
   *   ADMIN        สร้างได้ถึงระดับ ADMIN
   *   USER         สร้างได้เฉพาะ USER ต่อให้มีสิทธิ์ user.create ก็ตาม
   */
  private assertCanGrantAccountType(actor: AuthenticatedUser, target: AccountType): void {
    if (actor.accountType === AccountType.SUPER_ADMIN) {
      return;
    }

    if (target === AccountType.SUPER_ADMIN) {
      throw new ForbiddenException('เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่สร้างบัญชีระดับนี้ได้');
    }

    if (target === AccountType.ADMIN && actor.accountType !== AccountType.ADMIN) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์สร้างหรือแก้ไขบัญชีระดับผู้ดูแลระบบ');
    }
  }

  /** บัญชี SUPER_ADMIN ถูกแก้ไขได้โดย SUPER_ADMIN เท่านั้น ADMIN แตะไม่ได้ */
  private assertCanManage(actor: AuthenticatedUser, target: User): void {
    if (
      target.accountType === AccountType.SUPER_ADMIN &&
      actor.accountType !== AccountType.SUPER_ADMIN
    ) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขบัญชีของผู้ดูแลระบบสูงสุด');
    }
  }

  private async assertNotLastSuperAdmin(excludeUserId: number): Promise<void> {
    const remaining = await this.userModel.count({
      where: {
        accountType: AccountType.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        id: { [Op.ne]: excludeUserId },
      },
    });

    if (remaining === 0) {
      throw new BadRequestException(
        'ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชีเสมอ ไม่สามารถดำเนินการกับบัญชีสุดท้ายได้',
      );
    }
  }

  /**
   * username, email และ employee_code เป็น unique index ที่ไม่สนใจ deleted_at
   * จึงต้องตรวจรวมแถวที่ถูก soft delete ไปแล้วด้วย ไม่งั้นจะไปพังที่ระดับ DB
   */
  private async assertIdentifiersAreAvailable(
    dto: Partial<CreateUserDto>,
    excludeId?: number,
  ): Promise<void> {
    const checks: {
      field: 'username' | 'email' | 'employeeCode';
      value: string;
      message: string;
    }[] = [];

    if (dto.username) {
      checks.push({ field: 'username', value: dto.username, message: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
    }

    if (dto.email) {
      checks.push({ field: 'email', value: dto.email, message: 'อีเมลนี้ถูกใช้ไปแล้ว' });
    }

    if (dto.employeeCode) {
      checks.push({
        field: 'employeeCode',
        value: dto.employeeCode,
        message: 'รหัสพนักงานนี้ถูกใช้ไปแล้ว',
      });
    }

    for (const check of checks) {
      const where: WhereOptions<User> = excludeId
        ? { [check.field]: check.value, id: { [Op.ne]: excludeId } }
        : { [check.field]: check.value };

      const existing = await this.userModel.findOne({ where, paranoid: false });

      if (existing) {
        throw new ConflictException(check.message);
      }
    }
  }

  /** ตรวจว่าบทบาทที่ส่งมามีอยู่จริงและเปิดใช้งานอยู่ทุกตัว */
  private async resolveRoleIds(ids: number[], targetAccountType: AccountType): Promise<number[]> {
    // SUPER_ADMIN bypass การตรวจสิทธิ์ทั้งหมดอยู่แล้ว การผูกบทบาทจึงไม่มีผลใด ๆ
    // ปฏิเสธไปเลยดีกว่าปล่อยให้ผูกได้แล้วเข้าใจผิดว่าจำกัดสิทธิ์ได้ (CLAUDE.md 4.1)
    if (targetAccountType === AccountType.SUPER_ADMIN && ids.length > 0) {
      throw new BadRequestException(
        'บัญชีระดับ SUPER_ADMIN ไม่ต้องผูกบทบาท เพราะมีสิทธิ์ทุกอย่างอยู่แล้ว',
      );
    }

    if (ids.length === 0) {
      return [];
    }

    const roles = await this.roleModel.findAll({
      attributes: ['id', 'isActive'],
      where: { id: ids },
    });

    if (roles.length !== ids.length) {
      const found = new Set(roles.map((role) => role.id));
      const missing = ids.filter((id) => !found.has(id));
      throw new BadRequestException('ไม่พบบทบาทที่ระบุ: ' + missing.join(', '));
    }

    const inactive = roles.filter((role) => !role.isActive);

    if (inactive.length > 0) {
      throw new BadRequestException(
        'บทบาทที่ปิดใช้งานอยู่ผูกให้ผู้ใช้ไม่ได้: ' + inactive.map((role) => role.id).join(', '),
      );
    }

    return ids;
  }

  private async replaceRoles(
    userId: number,
    roleIds: number[],
    actorId: number,
    transaction: Transaction,
  ): Promise<void> {
    await this.userRoleModel.destroy({ where: { userId }, transaction });

    if (roleIds.length === 0) {
      return;
    }

    await this.userRoleModel.bulkCreate(
      roleIds.map((roleId) => ({ userId, roleId, createdBy: actorId })),
      { transaction },
    );
  }
}
