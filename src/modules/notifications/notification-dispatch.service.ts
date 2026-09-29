import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { addDays, todayAsDateOnly } from '../../common/utils/date.util';
import { OPEN_FOLLOW_UP_STATUSES } from '../follow-ups/dto/follow-up.response';
import {
  Customer,
  CustomerStatus,
  FollowUp,
  MaContract,
  MaContractStatus,
  Notification,
  NotificationEventType,
  NotificationRule,
  NotificationStatus,
  Task,
  TaskStatus,
  Ticket,
  TicketStatus,
  User,
  UserRole,
  UserStatus,
  Warranty,
  WarrantyStatus,
} from '../../models';
import { LineMessagingService } from './line-messaging.service';
import { DispatchRunResultDto } from './dto/notification.response';

interface Candidate {
  refType: string;
  refId: number;
  title: string;
  detail: string;
  /** ถ้ามี = ส่งให้คนนี้เพิ่มจาก target ของกฎ (เช่น ผู้รับผิดชอบงาน) */
  assigneeUserId?: number | null;
}

/**
 * ไล่กฎที่เปิดอยู่ → หาเหตุการณ์ → สร้าง notifications → ส่ง LINE
 *
 * ป้องกันซ้ำ: ถ้ามีแจ้งเตือน event+target+ref เดียวกันในวันเดียวกันแล้ว (ยังไม่ soft-delete)
 * จะไม่สร้างซ้ำ — cron รันบ่อยแค่ไหนก็ได้ในวันเดียวโดยไม่สแปม
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    @InjectModel(NotificationRule) private readonly ruleModel: typeof NotificationRule,
    @InjectModel(Notification) private readonly notificationModel: typeof Notification,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserRole) private readonly userRoleModel: typeof UserRole,
    @InjectModel(Warranty) private readonly warrantyModel: typeof Warranty,
    @InjectModel(MaContract) private readonly maContractModel: typeof MaContract,
    @InjectModel(Task) private readonly taskModel: typeof Task,
    @InjectModel(FollowUp) private readonly followUpModel: typeof FollowUp,
    @InjectModel(Ticket) private readonly ticketModel: typeof Ticket,
    @InjectModel(Customer) private readonly customerModel: typeof Customer,
    private readonly lineMessaging: LineMessagingService,
  ) {}

  async runAll(): Promise<DispatchRunResultDto> {
    const result: DispatchRunResultDto = {
      rulesProcessed: 0,
      created: 0,
      lineSent: 0,
      lineFailed: 0,
      skippedDuplicate: 0,
    };

    const rules = await this.ruleModel.findAll({ where: { isActive: true } });
    for (const rule of rules) {
      result.rulesProcessed += 1;
      try {
        const partial = await this.runRule(rule);
        result.created += partial.created;
        result.lineSent += partial.lineSent;
        result.lineFailed += partial.lineFailed;
        result.skippedDuplicate += partial.skippedDuplicate;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`กฎ #${rule.id} (${rule.eventType}) ล้มเหลว: ${message}`);
      }
    }

    return result;
  }

  private async runRule(
    rule: NotificationRule,
  ): Promise<Omit<DispatchRunResultDto, 'rulesProcessed'>> {
    const partial = { created: 0, lineSent: 0, lineFailed: 0, skippedDuplicate: 0 };
    const candidates = await this.findCandidates(rule);
    if (candidates.length === 0) {
      return partial;
    }

    const targets = await this.resolveTargets(rule);
    if (targets.length === 0) {
      this.logger.warn(`กฎ #${rule.id} ไม่มีผู้รับ (role/user ว่างหรือไม่มี line/สถานะไม่พร้อม)`);
      return partial;
    }

    const todayStart = new Date(`${todayAsDateOnly()}T00:00:00`);

    for (const candidate of candidates) {
      const recipientIds = new Set(targets.map((u) => u.id));
      if (candidate.assigneeUserId) {
        recipientIds.add(candidate.assigneeUserId);
      }

      for (const userId of recipientIds) {
        const user =
          targets.find((u) => u.id === userId) ?? (await this.userModel.findByPk(userId));
        if (!user || user.status !== UserStatus.ACTIVE) {
          continue;
        }

        const exists = await this.notificationModel.findOne({
          where: {
            eventType: rule.eventType,
            targetUserId: user.id,
            refType: candidate.refType,
            refId: candidate.refId,
            createdAt: { [Op.gte]: todayStart },
          },
        });
        if (exists) {
          partial.skippedDuplicate += 1;
          continue;
        }

        const title = candidate.title;
        const message = [rule.messageTemplate?.trim(), candidate.detail].filter(Boolean).join('\n');

        const row = await this.notificationModel.create({
          ruleId: rule.id,
          targetUserId: user.id,
          eventType: rule.eventType,
          title,
          message: message || null,
          refType: candidate.refType,
          refId: candidate.refId,
          status: NotificationStatus.PENDING,
          scheduledAt: new Date(),
        });
        partial.created += 1;

        if (!rule.sendLine) {
          await row.update({
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          });
          continue;
        }

        if (!user.lineUserId) {
          await row.update({
            status: NotificationStatus.FAILED,
            errorMessage: 'ผู้ใช้ยังไม่มี lineUserId',
          });
          partial.lineFailed += 1;
          continue;
        }

        if (!this.lineMessaging.isConfigured()) {
          await row.update({
            status: NotificationStatus.FAILED,
            errorMessage: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN',
          });
          partial.lineFailed += 1;
          continue;
        }

        const text = `${title}${message ? `\n${message}` : ''}`;
        const push = await this.lineMessaging.pushText(user.lineUserId, text);
        if (push.ok) {
          await row.update({
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            errorMessage: null,
          });
          partial.lineSent += 1;
        } else {
          await row.update({
            status: NotificationStatus.FAILED,
            errorMessage: `LINE HTTP ${push.status}: ${push.body.slice(0, 500)}`,
          });
          partial.lineFailed += 1;
        }
      }
    }

    return partial;
  }

  private async resolveTargets(rule: NotificationRule): Promise<User[]> {
    const users: User[] = [];

    if (rule.targetUserId) {
      const user = await this.userModel.findByPk(rule.targetUserId);
      if (user && user.status === UserStatus.ACTIVE) {
        users.push(user);
      }
    }

    if (rule.targetRoleId) {
      const links = await this.userRoleModel.findAll({
        where: { roleId: rule.targetRoleId },
      });
      if (links.length > 0) {
        const roleUsers = await this.userModel.findAll({
          where: {
            id: { [Op.in]: links.map((l) => l.userId) },
            status: UserStatus.ACTIVE,
          },
        });
        users.push(...roleUsers);
      }
    }

    // unique by id
    const byId = new Map<number, User>();
    for (const user of users) {
      byId.set(user.id, user);
    }
    return [...byId.values()];
  }

  private async findCandidates(rule: NotificationRule): Promise<Candidate[]> {
    const today = todayAsDateOnly();
    const daysBefore = rule.daysBefore ?? 7;

    switch (rule.eventType) {
      case NotificationEventType.WARRANTY_EXPIRING:
        return this.warrantyExpiring(today, daysBefore);
      case NotificationEventType.MA_EXPIRING:
        return this.maExpiring(today, daysBefore);
      case NotificationEventType.TASK_OVERDUE:
        return this.tasksOverdue(today);
      case NotificationEventType.FOLLOWUP_DUE:
        return this.followUpsDue(today);
      case NotificationEventType.TICKET_SLA:
        return this.ticketsSla();
      case NotificationEventType.CUSTOMER_IDLE:
        return this.customersIdle(daysBefore);
      case NotificationEventType.DELIVERY_DUE:
        // ยังไม่มี due_date ของใบส่งมอบใน schema — ข้ามไว้ก่อน อย่าเดา
        this.logger.warn('DELIVERY_DUE ยังไม่มีฟิลด์ due ใน deliveries — ข้าม');
        return [];
      default:
        return [];
    }
  }

  private async warrantyExpiring(today: string, daysBefore: number): Promise<Candidate[]> {
    const until = addDays(today, daysBefore);
    const rows = await this.warrantyModel.findAll({
      where: {
        status: { [Op.ne]: WarrantyStatus.VOID },
        endDate: { [Op.between]: [today, until] },
      },
      limit: 200,
    });
    return rows.map((w) => ({
      refType: 'WARRANTY',
      refId: w.id,
      title: `ประกันใกล้หมดอายุ (#${w.id})`,
      detail: `วันสิ้นสุด ${w.endDate}`,
    }));
  }

  private async maExpiring(today: string, daysBefore: number): Promise<Candidate[]> {
    const until = addDays(today, daysBefore);
    const rows = await this.maContractModel.findAll({
      where: {
        status: MaContractStatus.ACTIVE,
        endDate: { [Op.between]: [today, until] },
        startDate: { [Op.lte]: today },
      },
      limit: 200,
    });
    return rows.map((c) => ({
      refType: 'MA_CONTRACT',
      refId: c.id,
      title: `สัญญา MA ใกล้หมดอายุ${c.contractNo ? ` (${c.contractNo})` : ` (#${c.id})`}`,
      detail: `วันสิ้นสุด ${c.endDate}`,
    }));
  }

  private async tasksOverdue(today: string): Promise<Candidate[]> {
    const rows = await this.taskModel.findAll({
      where: {
        status: { [Op.ne]: TaskStatus.DONE },
        dueDate: { [Op.lt]: today, [Op.ne]: null },
      },
      limit: 200,
    });
    return rows.map((t) => ({
      refType: 'TASK',
      refId: t.id,
      title: `งานเกินกำหนด: ${t.title}`,
      detail: `ครบกำหนด ${t.dueDate}`,
      assigneeUserId: t.assignedUserId,
    }));
  }

  private async followUpsDue(today: string): Promise<Candidate[]> {
    const rows = await this.followUpModel.findAll({
      where: {
        status: { [Op.in]: [...OPEN_FOLLOW_UP_STATUSES] },
        dueDate: { [Op.lt]: today },
      },
      limit: 200,
    });
    return rows.map((f) => ({
      refType: 'FOLLOW_UP',
      refId: f.id,
      title: `งานติดตามเลยกำหนด: ${f.title}`,
      detail: `ครบกำหนด ${f.dueDate}`,
      assigneeUserId: f.assignedUserId,
    }));
  }

  private async ticketsSla(): Promise<Candidate[]> {
    const now = new Date();
    const rows = await this.ticketModel.findAll({
      where: {
        status: {
          [Op.in]: [
            TicketStatus.RECEIVED,
            TicketStatus.ASSIGNED,
            TicketStatus.REOPENED,
            TicketStatus.IN_PROGRESS,
          ],
        },
        dueAt: { [Op.lt]: now, [Op.ne]: null },
      },
      limit: 200,
    });
    return rows.map((t) => ({
      refType: 'TICKET',
      refId: t.id,
      title: `ใบแจ้งปัญหาเลยกำหนด${t.ticketNo ? ` (${t.ticketNo})` : ` (#${t.id})`}`,
      detail: t.title,
      assigneeUserId: t.assignedUserId,
    }));
  }

  private async customersIdle(idleDays: number): Promise<Candidate[]> {
    const cutoff = addDays(todayAsDateOnly(), -Math.max(idleDays, 1));
    const rows = await this.customerModel.findAll({
      where: {
        // CHURNED = เลิกใช้บริการ / ไม่ติดตามต่อ — INACTIVE ยังเตือน เพราะเป็นกลุ่มที่ควรตามเสนอ MA
        status: { [Op.ne]: CustomerStatus.CHURNED },
        [Op.or]: [
          { lastContactedAt: null },
          { lastContactedAt: { [Op.lt]: new Date(`${cutoff}T00:00:00`) } },
        ],
      },
      limit: 200,
    });
    return rows.map((c) => ({
      refType: 'CUSTOMER',
      refId: c.id,
      title: `ลูกค้าที่ไม่ได้ติดต่อนาน: ${c.name}`,
      detail: c.lastContactedAt
        ? `ติดต่อล่าสุด ${toDateHint(c.lastContactedAt)}`
        : 'ยังไม่เคยบันทึกการติดต่อ',
    }));
  }
}

function toDateHint(value: Date): string {
  return value.toISOString().slice(0, 10);
}
