import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import {
  AccountType,
  Notification,
  NotificationEventType,
  NotificationStatus,
  Permission,
  Role,
  RolePermission,
  User,
  UserRole,
  UserStatus,
} from '../../models';

export interface TicketNotifyRef {
  id: number;
  ticketNo: string | null;
  title: string;
  claimedByAdminUserId?: number | null;
  receivedByUserId?: number | null;
  assignedUserId?: number | null;
}

/**
 * C-3 — สร้างแจ้งเตือนในแอปทันทีตอนส่งงานข้ามฝ่าย
 *
 * ไม่ส่ง LINE โดยเจตนา: ช่อง LINE ยังใช้กับวันหมดอายุ/กำหนดตามที่พี่เลี้ยงเน้น
 * แถวที่สร้างมี status = SENT ทันที (โผล่ใน inbox / กระดิ่งบนหัวได้เลย)
 *
 * ล้มเหลวตอนแจ้งต้องไม่ทำให้ action ของใบพัง — เรียกแล้วกลืน error + log
 */
@Injectable()
export class TicketWorkflowNotifyService {
  private readonly logger = new Logger(TicketWorkflowNotifyService.name);

  constructor(
    @InjectModel(Notification) private readonly notificationModel: typeof Notification,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserRole) private readonly userRoleModel: typeof UserRole,
    @InjectModel(Permission) private readonly permissionModel: typeof Permission,
    @InjectModel(RolePermission) private readonly rolePermissionModel: typeof RolePermission,
    @InjectModel(Role) private readonly roleModel: typeof Role,
  ) {}

  async notifySentToAdmin(ticket: TicketNotifyRef, actorUserId: number | null): Promise<void> {
    await this.safeRun('TICKET_SENT_TO_ADMIN', async () => {
      const recipients = await this.findTicketAssignUserIds();
      const label = this.ticketLabel(ticket);
      await this.createForUsers({
        eventType: NotificationEventType.TICKET_SENT_TO_ADMIN,
        ticket,
        recipientIds: recipients,
        excludeUserId: actorUserId,
        title: `มีใบรอรับในคิวแอดมิน — ${label}`,
        message: `ใบ「${ticket.title}」ถูกส่งเข้าคิวกลางแล้ว กรุณารับเรื่องและจัดแจง`,
      });
    });
  }

  async notifyAwaitingReview(ticket: TicketNotifyRef, actorUserId: number | null): Promise<void> {
    await this.safeRun('TICKET_AWAITING_REVIEW', async () => {
      const recipients = ticket.claimedByAdminUserId
        ? [ticket.claimedByAdminUserId]
        : await this.findTicketAssignUserIds();
      const label = this.ticketLabel(ticket);
      await this.createForUsers({
        eventType: NotificationEventType.TICKET_AWAITING_REVIEW,
        ticket,
        recipientIds: recipients,
        excludeUserId: actorUserId,
        title: `มีใบรอตรวจผ่าน — ${label}`,
        message: `ใบ「${ticket.title}」บันทึกผลการแก้ไขแล้ว กรุณาตรวจแล้วส่งกลับซัพพอร์ต`,
      });
    });
  }

  async notifyReturnedToSupport(
    ticket: TicketNotifyRef,
    actorUserId: number | null,
  ): Promise<void> {
    await this.safeRun('TICKET_RETURNED_TO_SUPPORT', async () => {
      if (!ticket.receivedByUserId) {
        this.logger.warn(
          `ใบ #${ticket.id} ส่งกลับซัพพอร์ตแล้วแต่ไม่มี receivedByUserId — ข้ามแจ้งเตือน`,
        );
        return;
      }
      const label = this.ticketLabel(ticket);
      await this.createForUsers({
        eventType: NotificationEventType.TICKET_RETURNED_TO_SUPPORT,
        ticket,
        recipientIds: [ticket.receivedByUserId],
        excludeUserId: actorUserId,
        title: `มีใบรอบอกลูกค้า — ${label}`,
        message: `ใบ「${ticket.title}」แอดมินตรวจผ่านแล้ว กรุณาบอกลูกค้าแล้วปิดงาน`,
      });
    });
  }

  async notifyAssigned(ticket: TicketNotifyRef, actorUserId: number | null): Promise<void> {
    await this.safeRun('TICKET_ASSIGNED', async () => {
      if (!ticket.assignedUserId) {
        return;
      }
      const label = this.ticketLabel(ticket);
      await this.createForUsers({
        eventType: NotificationEventType.TICKET_ASSIGNED,
        ticket,
        recipientIds: [ticket.assignedUserId],
        excludeUserId: actorUserId,
        title: `มีใบมอบหมายให้คุณ — ${label}`,
        message: `ใบ「${ticket.title}」ถูกมอบหมายให้คุณแล้ว กรุณากดเริ่มงานเมื่อพร้อมลงมือ`,
      });
    });
  }

  async notifyReviewRejected(
    ticket: TicketNotifyRef,
    actorUserId: number | null,
    reason: string,
  ): Promise<void> {
    await this.safeRun('TICKET_REVIEW_REJECTED', async () => {
      if (!ticket.assignedUserId) {
        return;
      }
      const label = this.ticketLabel(ticket);
      await this.createForUsers({
        eventType: NotificationEventType.TICKET_REVIEW_REJECTED,
        ticket,
        recipientIds: [ticket.assignedUserId],
        excludeUserId: actorUserId,
        title: `ใบถูกตีกลับให้แก้ต่อ — ${label}`,
        message: `ใบ「${ticket.title}」แอดมินตรวจไม่ผ่าน: ${reason}`,
      });
    });
  }

  private ticketLabel(ticket: TicketNotifyRef): string {
    return ticket.ticketNo?.trim() || `#${ticket.id}`;
  }

  private async safeRun(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`แจ้งเตือน ${label} ล้มเหลว: ${message}`);
    }
  }

  async findTicketAssignUserIds(): Promise<number[]> {
    const ids = new Set<number>();

    const privileged = await this.userModel.findAll({
      attributes: ['id'],
      where: {
        status: UserStatus.ACTIVE,
        accountType: { [Op.in]: [AccountType.SUPER_ADMIN, AccountType.ADMIN] },
      },
    });
    for (const user of privileged) {
      ids.add(user.id);
    }

    const permission = await this.permissionModel.findOne({
      where: { code: 'ticket.assign' },
      attributes: ['id'],
    });
    if (permission) {
      const links = await this.rolePermissionModel.findAll({
        where: { permissionId: permission.id },
        attributes: ['roleId'],
      });
      const roleIds = [
        ...new Set(
          (
            await this.roleModel.findAll({
              where: { id: { [Op.in]: links.map((link) => link.roleId) }, isActive: true },
              attributes: ['id'],
            })
          ).map((role) => role.id),
        ),
      ];
      if (roleIds.length > 0) {
        const userRoles = await this.userRoleModel.findAll({
          where: { roleId: { [Op.in]: roleIds } },
          attributes: ['userId'],
        });
        const userIds = [...new Set(userRoles.map((link) => link.userId))];
        if (userIds.length > 0) {
          const activeUsers = await this.userModel.findAll({
            where: { id: { [Op.in]: userIds }, status: UserStatus.ACTIVE },
            attributes: ['id'],
          });
          for (const user of activeUsers) {
            ids.add(user.id);
          }
        }
      }
    }

    return [...ids];
  }

  private async createForUsers(input: {
    eventType: NotificationEventType;
    ticket: TicketNotifyRef;
    recipientIds: number[];
    excludeUserId: number | null;
    title: string;
    message: string;
  }): Promise<void> {
    const uniqueIds = [...new Set(input.recipientIds)].filter(
      (id) => id && id !== input.excludeUserId,
    );

    for (const userId of uniqueIds) {
      const user = await this.userModel.findByPk(userId, { attributes: ['id', 'status'] });
      if (!user || user.status !== UserStatus.ACTIVE) {
        continue;
      }

      const exists = await this.notificationModel.findOne({
        where: {
          eventType: input.eventType,
          targetUserId: userId,
          refType: 'TICKET',
          refId: input.ticket.id,
          status: { [Op.ne]: NotificationStatus.READ },
        },
      });
      if (exists) {
        continue;
      }

      const now = new Date();
      await this.notificationModel.create({
        ruleId: null,
        targetUserId: userId,
        eventType: input.eventType,
        title: input.title,
        message: input.message,
        refType: 'TICKET',
        refId: input.ticket.id,
        status: NotificationStatus.SENT,
        scheduledAt: now,
        sentAt: now,
        createdBy: input.excludeUserId,
        updatedBy: input.excludeUserId,
      });
    }
  }
}
