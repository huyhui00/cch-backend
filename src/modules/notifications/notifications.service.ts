import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { AccessControlService } from '../../common/services/access-control.service';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  toPaginatedResult,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { Notification, NotificationStatus, User, UserStatus } from '../../models';
import { LineMessagingService } from './line-messaging.service';
import { QueryNotificationsDto, TestLinePushDto } from './dto/notification.dto';
import {
  NotificationResponseDto,
  toNotificationResponse,
} from './dto/notification.response';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification) private readonly notificationModel: typeof Notification,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly lineMessaging: LineMessagingService,
    private readonly accessControl: AccessControlService,
  ) {}

  async findAll(
    query: QueryNotificationsDto,
    viewer: AuthenticatedUser,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Record<string, unknown> = {};

    if (query.all) {
      if (!(await this.accessControl.hasPermission(viewer, 'notification.manage'))) {
        throw new ForbiddenException('คุณไม่มีสิทธิ์ดูการแจ้งเตือนของผู้อื่น');
      }
    } else {
      where.targetUserId = viewer.id;
    }

    if (query.status) {
      where.status = query.status;
    }

    const { rows, count } = await this.notificationModel.findAndCountAll({
      where,
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset: (page - 1) * limit,
    });

    return toPaginatedResult(rows.map(toNotificationResponse), count, { page, limit });
  }

  async findOne(id: number, viewer: AuthenticatedUser): Promise<NotificationResponseDto> {
    const row = await this.requireReadable(id, viewer);
    return toNotificationResponse(row);
  }

  async markRead(id: number, viewer: AuthenticatedUser): Promise<NotificationResponseDto> {
    const row = await this.requireReadable(id, viewer);

    if (row.status === NotificationStatus.READ) {
      return toNotificationResponse(row);
    }

    await row.update({
      status: NotificationStatus.READ,
      readAt: row.readAt ?? new Date(),
      updatedBy: viewer.id,
    });

    return toNotificationResponse(row);
  }

  /**
   * ส่งข้อความทดสอบไป LINE ของพนักงาน — ใช้ตรวจว่า token + lineUserId ถูกต้อง
   * ยังไม่สร้างแถวใน notifications (เป็นการทดสอบช่องทาง ไม่ใช่เหตุการณ์จริง)
   */
  async testLinePush(
    dto: TestLinePushDto,
    viewer: AuthenticatedUser,
  ): Promise<{ lineUserId: string; displayHint: string }> {
    const targetUserId = dto.userId ?? viewer.id;
    if (
      targetUserId !== viewer.id &&
      !(await this.accessControl.hasPermission(viewer, 'notification.manage'))
    ) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ทดสอบส่ง LINE ไปหาผู้อื่น');
    }

    const user = await this.userModel.findByPk(targetUserId);
    if (!user || user.status === UserStatus.RESIGNED) {
      throw new NotFoundException('ไม่พบผู้ใช้นี้');
    }
    if (!user.lineUserId) {
      throw new BadRequestException(
        'ผู้ใช้นี้ยังไม่มี lineUserId — ตั้งค่าผ่าน PUT /api/users/:id หรือผูกจาก webhook ทีหลัง',
      );
    }
    if (!this.lineMessaging.isConfigured()) {
      throw new ServiceUnavailableException(
        'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN จึงส่งแจ้งเตือนผ่าน LINE ไม่ได้',
      );
    }

    const text = dto.message?.trim() || '[CPAMS] ทดสอบแจ้งเตือนจากระบบ';
    const result = await this.lineMessaging.pushText(user.lineUserId, text);
    if (!result.ok) {
      throw new ServiceUnavailableException(
        `ส่ง LINE ไม่สำเร็จ (HTTP ${result.status}) — ตรวจ token และว่าผู้ใช้แอด OA เป็นเพื่อนแล้ว`,
      );
    }

    return {
      lineUserId: user.lineUserId,
      displayHint: user.fullName || user.username,
    };
  }

  private async requireReadable(id: number, viewer: AuthenticatedUser): Promise<Notification> {
    const row = await this.notificationModel.findByPk(id);
    if (!row) {
      throw new NotFoundException('ไม่พบการแจ้งเตือนนี้');
    }

    if (
      row.targetUserId !== viewer.id &&
      !(await this.accessControl.hasPermission(viewer, 'notification.manage'))
    ) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงการแจ้งเตือนนี้');
    }

    return row;
  }
}
