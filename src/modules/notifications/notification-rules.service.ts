import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  toPaginatedResult,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import { NotificationEventType, NotificationRule, Role, User, UserStatus } from '../../models';
import {
  CreateNotificationRuleDto,
  QueryNotificationRulesDto,
  UpdateNotificationRuleDto,
} from './dto/notification.dto';
import {
  NotificationRuleResponseDto,
  toNotificationRuleResponse,
} from './dto/notification.response';

/** DAILY_DIGEST เป็นชนิดของแถวสรุปรูปแบบเดิม ไม่ใช่หัวข้อ — ทำเป็นกฎจะไม่มีอะไรให้ตรวจ */
function assertRuleEventType(eventType: NotificationEventType): void {
  if (eventType === NotificationEventType.DAILY_DIGEST) {
    throw new BadRequestException('สรุปประจำวันไม่ใช่หัวข้อแจ้งเตือน เลือกชนิดเหตุการณ์อื่น');
  }
}

@Injectable()
export class NotificationRulesService {
  constructor(
    @InjectModel(NotificationRule) private readonly ruleModel: typeof NotificationRule,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async findAll(
    query: QueryNotificationRulesDto,
  ): Promise<PaginatedResult<NotificationRuleResponseDto>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: WhereOptions<NotificationRule> = {};

    if (query.eventType) where.eventType = query.eventType;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search?.trim()) {
      where.name = { [Op.like]: `%${query.search.trim()}%` };
    }

    const { rows, count } = await this.ruleModel.findAndCountAll({
      where,
      order: [['id', 'ASC']],
      limit,
      offset: (page - 1) * limit,
    });

    return toPaginatedResult(rows.map(toNotificationRuleResponse), count, { page, limit });
  }

  async findOne(id: number): Promise<NotificationRuleResponseDto> {
    return toNotificationRuleResponse(await this.requireRule(id));
  }

  async create(
    dto: CreateNotificationRuleDto,
    actorId: number,
  ): Promise<NotificationRuleResponseDto> {
    assertRuleEventType(dto.eventType);
    await this.assertTargets(dto.targetRoleId, dto.targetUserId);

    const row = await this.ruleModel.create({
      name: dto.name.trim(),
      eventType: dto.eventType,
      daysBefore: dto.daysBefore ?? null,
      isActive: dto.isActive ?? true,
      targetRoleId: dto.targetRoleId ?? null,
      targetUserId: dto.targetUserId ?? null,
      messageTemplate: dto.messageTemplate?.trim() || null,
      sendLine: dto.sendLine ?? true,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return toNotificationRuleResponse(row);
  }

  async update(
    id: number,
    dto: UpdateNotificationRuleDto,
    actorId: number,
  ): Promise<NotificationRuleResponseDto> {
    const row = await this.requireRule(id);
    if (dto.eventType !== undefined) {
      assertRuleEventType(dto.eventType);
    }

    const nextRoleId = dto.targetRoleId !== undefined ? dto.targetRoleId : row.targetRoleId;
    const nextUserId = dto.targetUserId !== undefined ? dto.targetUserId : row.targetUserId;
    if (dto.targetRoleId !== undefined || dto.targetUserId !== undefined) {
      await this.assertTargets(nextRoleId, nextUserId);
    }

    await row.update({
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.eventType !== undefined ? { eventType: dto.eventType } : {}),
      ...(dto.daysBefore !== undefined ? { daysBefore: dto.daysBefore } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.targetRoleId !== undefined ? { targetRoleId: dto.targetRoleId } : {}),
      ...(dto.targetUserId !== undefined ? { targetUserId: dto.targetUserId } : {}),
      ...(dto.messageTemplate !== undefined
        ? { messageTemplate: dto.messageTemplate?.trim() || null }
        : {}),
      ...(dto.sendLine !== undefined ? { sendLine: dto.sendLine } : {}),
      updatedBy: actorId,
    });

    return toNotificationRuleResponse(row);
  }

  async remove(id: number, actorId: number): Promise<void> {
    const row = await this.requireRule(id);
    await row.update({ deletedBy: actorId, updatedBy: actorId });
    await row.destroy();
  }

  private async requireRule(id: number): Promise<NotificationRule> {
    const row = await this.ruleModel.findByPk(id);
    if (!row) {
      throw new NotFoundException('ไม่พบกฎการแจ้งเตือนนี้');
    }
    return row;
  }

  private async assertTargets(
    targetRoleId: number | null | undefined,
    targetUserId: number | null | undefined,
  ): Promise<void> {
    if (!targetRoleId && !targetUserId) {
      throw new BadRequestException(
        'ต้องระบุ targetRoleId หรือ targetUserId อย่างน้อยหนึ่งอย่าง (BR-11 แจ้งเฉพาะพนักงาน)',
      );
    }

    if (targetRoleId) {
      const role = await this.roleModel.findByPk(targetRoleId);
      if (!role) {
        throw new NotFoundException('ไม่พบบทบาทที่ระบุเป็นปลายทาง');
      }
    }

    if (targetUserId) {
      const user = await this.userModel.findByPk(targetUserId);
      if (!user || user.status === UserStatus.RESIGNED) {
        throw new NotFoundException('ไม่พบผู้ใช้ที่ระบุเป็นปลายทาง');
      }
    }
  }
}
