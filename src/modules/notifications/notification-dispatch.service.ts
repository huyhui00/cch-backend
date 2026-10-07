import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { addDays, toDateOnly, todayAsDateOnly } from '../../common/utils/date.util';
import { OPEN_FOLLOW_UP_STATUSES } from '../follow-ups/dto/follow-up.response';
import {
  Customer,
  FollowUp,
  MaContract,
  MaContractStatus,
  Notification,
  NotificationEventType,
  NotificationRule,
  NotificationStatus,
  Project,
  ProjectStatus,
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
import {
  DIGEST_DEFAULT_DAYS,
  DIGEST_EVENT_ORDER,
  DIGEST_ITEM_LIMIT,
  type DigestGroup,
  type DigestSection,
  type DueKind,
  OVERDUE_LOOKBACK_DAYS,
  buildDigest,
  dateLine,
  digestHeading,
  digestItem,
  itemTitle,
} from './notification-digest';

const OPEN_TICKET_STATUSES = [
  TicketStatus.RECEIVED,
  TicketStatus.WAITING_ADMIN,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.REOPENED,
];

const MA_FOOTER = 'โทรยืนยันกับลูกค้าว่าจะต่อสัญญาหรือไม่';

/** รายการหนึ่งที่เข้าเกณฑ์ ณ ตอนนี้ — จะถูกแจ้งถ้ายังไม่เคยแจ้ง `key` นี้ให้ผู้รับคนนั้น */
interface DueCandidate {
  key: string;
  refType: string;
  refId: number;
  kind: DueKind;
  /** วันกำหนด ใช้เรียง (ใกล้ครบ = ใกล้สุดก่อน · เลยกำหนด = เพิ่งเลยก่อน) */
  sortDate: string;
  item: string;
}

interface PendingEntry {
  rule: NotificationRule;
  candidate: DueCandidate;
}

interface Recipient {
  user: User;
  entries: PendingEntry[];
}

function dueKey(
  eventType: NotificationEventType,
  refType: string,
  refId: number,
  kind: DueKind,
  date: string,
): string {
  return `${eventType}:${refType}:${refId}:${kind}:${date}`;
}

function kindOf(date: string, today: string): DueKind {
  return date < today ? 'OVERDUE' : 'UPCOMING';
}

/**
 * แจ้งตามกำหนดของแต่ละรายการ (7 ต.ค.) — แจ้งเมื่อรายการเข้าช่วง "ใกล้ครบ" ครั้งหนึ่ง
 * และเมื่อ "เลยกำหนด" อีกครั้งหนึ่ง ไม่แจ้งซ้ำ (`notifications.dedupe_key`)
 *
 * รอบหนึ่งรวมรายการใหม่ของผู้รับคนเดียวกันเป็นข้อความ LINE เดียว · กระดิ่งได้หนึ่งแถวต่อรายการ (กดไปหน้ารายการได้)
 * ทุกผู้รับเห็นรายการชุดเดียวกันทั้งบริษัท ไม่กรองตามผู้รับผิดชอบหรือสิทธิ์ (ตัดสิน 7 ต.ค. รอถามพี่เลี้ยง)
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
    @InjectModel(Project) private readonly projectModel: typeof Project,
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
    const now = new Date();
    const today = todayAsDateOnly();

    const rules = await this.ruleModel.findAll({
      where: { isActive: true, eventType: { [Op.in]: [...DIGEST_EVENT_ORDER] } },
      order: [['id', 'ASC']],
    });

    const recipients = new Map<number, Recipient>();
    for (const rule of rules) {
      result.rulesProcessed += 1;
      try {
        const candidates = await this.findCandidates(rule.eventType, today, daysFor(rule), now);
        if (candidates.length === 0) {
          continue;
        }

        const targets = await this.resolveTargets(rule);
        if (targets.length === 0) {
          this.logger.warn(`กฎ #${rule.id} ไม่มีผู้รับ (role/user ว่างหรือสถานะไม่พร้อม)`);
        }
        for (const user of targets) {
          const entry = recipients.get(user.id) ?? { user, entries: [] };
          entry.entries.push(...candidates.map((candidate) => ({ rule, candidate })));
          recipients.set(user.id, entry);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`กฎ #${rule.id} (${rule.eventType}) ล้มเหลว: ${message}`);
      }
    }

    for (const recipient of recipients.values()) {
      await this.notifyRecipient(recipient, today, now, result);
    }
    return result;
  }

  private async notifyRecipient(
    { user, entries }: Recipient,
    today: string,
    now: Date,
    result: DispatchRunResultDto,
  ): Promise<void> {
    const byKey = new Map<string, PendingEntry>();
    for (const entry of entries) {
      byKey.set(entry.candidate.key, entry);
    }

    const already = await this.notificationModel.findAll({
      where: { targetUserId: user.id, dedupeKey: { [Op.in]: [...byKey.keys()] } },
      attributes: ['dedupeKey'],
      paranoid: false,
    });
    for (const row of already) {
      if (row.dedupeKey) byKey.delete(row.dedupeKey);
    }
    result.skippedDuplicate += already.length;

    const fresh = [...byKey.values()];
    if (fresh.length === 0) {
      return;
    }

    const rows: Notification[] = [];
    for (const { rule, candidate } of fresh) {
      rows.push(
        await this.notificationModel.create({
          ruleId: rule.id,
          targetUserId: user.id,
          eventType: rule.eventType,
          title: itemTitle(
            rule.eventType,
            candidate.kind,
            digestHeading(rule.eventType, daysFor(rule)),
          ),
          message: candidate.item,
          refType: candidate.refType,
          refId: candidate.refId,
          dedupeKey: candidate.key,
          status: NotificationStatus.PENDING,
          scheduledAt: now,
        }),
      );
    }
    result.created += rows.length;

    if (!fresh.some(({ rule }) => rule.sendLine)) {
      await this.markRows(rows, { status: NotificationStatus.SENT, sentAt: now });
      return;
    }

    const digest = buildDigest(today, this.toSections(fresh));
    if (!digest) {
      return;
    }
    if (await this.pushLine(rows, user, `${digest.title}\n\n${digest.message}`)) {
      result.lineSent += 1;
    } else {
      result.lineFailed += 1;
    }
  }

  /** รายการใหม่ของผู้รับคนหนึ่ง → หัวข้อในข้อความ LINE (หนึ่งกฎ = หนึ่งหัวข้อ) */
  private toSections(fresh: PendingEntry[]): DigestSection[] {
    const byRule = new Map<number, { rule: NotificationRule; candidates: DueCandidate[] }>();
    for (const { rule, candidate } of fresh) {
      const entry = byRule.get(rule.id) ?? { rule, candidates: [] };
      entry.candidates.push(candidate);
      byRule.set(rule.id, entry);
    }

    return [...byRule.values()].map(({ rule, candidates }) => {
      const group = (kind: DueKind): DigestGroup => {
        const list = candidates
          .filter((c) => c.kind === kind)
          .sort((a, b) =>
            kind === 'UPCOMING'
              ? a.sortDate.localeCompare(b.sortDate)
              : b.sortDate.localeCompare(a.sortDate),
          );
        return {
          kind,
          total: list.length,
          items: list.slice(0, DIGEST_ITEM_LIMIT).map((c) => c.item),
        };
      };
      const groups = [group('UPCOMING'), group('OVERDUE')].filter((g) => g.total > 0);
      const hasUpcoming = groups.some((g) => g.kind === 'UPCOMING');

      return {
        eventType: rule.eventType,
        heading: digestHeading(rule.eventType, daysFor(rule)),
        total: candidates.length,
        groups,
        footer:
          rule.eventType === NotificationEventType.MA_EXPIRING && hasUpcoming
            ? MA_FOOTER
            : undefined,
      };
    });
  }

  private async markRows(
    rows: Notification[],
    values: { status: NotificationStatus; sentAt?: Date; errorMessage?: string | null },
  ): Promise<void> {
    for (const row of rows) {
      await row.update(values);
    }
  }

  private async pushLine(rows: Notification[], user: User, text: string): Promise<boolean> {
    if (!user.lineUserId) {
      await this.markRows(rows, {
        status: NotificationStatus.FAILED,
        errorMessage: 'ผู้ใช้ยังไม่มี lineUserId',
      });
      return false;
    }

    if (!this.lineMessaging.isConfigured()) {
      await this.markRows(rows, {
        status: NotificationStatus.FAILED,
        errorMessage: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN',
      });
      return false;
    }

    const push = await this.lineMessaging.pushText(user.lineUserId, text);
    if (push.ok) {
      await this.markRows(rows, {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        errorMessage: null,
      });
      return true;
    }

    await this.markRows(rows, {
      status: NotificationStatus.FAILED,
      errorMessage: `LINE HTTP ${push.status}: ${push.body.slice(0, 500)}`,
    });
    return false;
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

    const byId = new Map<number, User>();
    for (const user of users) {
      byId.set(user.id, user);
    }
    return [...byId.values()];
  }

  /**
   * รายการที่เข้าเกณฑ์ตอนนี้ของหัวข้อหนึ่ง — ใกล้ครบ (วันนี้ถึงอีก N วัน) และเลยกำหนดไม่เกิน
   * `OVERDUE_LOOKBACK_DAYS` วัน · ประกัน/สัญญา MA มีแต่ใกล้หมด (หมดแล้วคือจบ)
   */
  private async findCandidates(
    eventType: NotificationEventType,
    today: string,
    days: number,
    now: Date,
  ): Promise<DueCandidate[]> {
    const until = addDays(today, days);
    const from = addDays(today, -OVERDUE_LOOKBACK_DAYS);

    switch (eventType) {
      case NotificationEventType.TASK_OVERDUE: {
        const rows = await this.taskModel.findAll({
          where: { status: { [Op.ne]: TaskStatus.DONE }, dueDate: { [Op.between]: [from, until] } },
          include: [
            {
              model: Project,
              required: true,
              attributes: ['id', 'name'],
              where: {
                status: { [Op.notIn]: [ProjectStatus.CLOSED, ProjectStatus.CANCELLED] },
              },
              include: [{ model: Customer, attributes: ['id', 'name'] }],
            },
          ],
        });
        return rows.map((t) => {
          const due = t.dueDate as string;
          const kind = kindOf(due, today);
          return {
            key: dueKey(eventType, 'TASK', t.id, kind, due),
            refType: 'TASK',
            refId: t.id,
            kind,
            sortDate: due,
            item: digestItem(`งาน: ${t.title}`, [
              `โปรเจกต์: ${t.project.name}`,
              `ลูกค้า: ${t.project.customer?.name ?? '-'}`,
              dateLine('ครบกำหนด', due, today),
            ]),
          };
        });
      }

      case NotificationEventType.DELIVERY_DUE: {
        const rows = await this.projectModel.findAll({
          where: {
            status: { [Op.in]: [ProjectStatus.DRAFT, ProjectStatus.IN_PROGRESS] },
            targetEndDate: { [Op.between]: [from, until] },
          },
          include: [{ model: Customer, attributes: ['id', 'name'] }],
        });
        return rows.map((p) => {
          const due = p.targetEndDate as string;
          const kind = kindOf(due, today);
          return {
            key: dueKey(eventType, 'PROJECT', p.id, kind, due),
            refType: 'PROJECT',
            refId: p.id,
            kind,
            sortDate: due,
            item: digestItem(`โปรเจกต์: ${p.name}`, [
              `ลูกค้า: ${p.customer?.name ?? '-'}`,
              dateLine('วันจบตามแผน', due, today),
            ]),
          };
        });
      }

      case NotificationEventType.FOLLOWUP_DUE: {
        const rows = await this.followUpModel.findAll({
          where: {
            status: { [Op.in]: [...OPEN_FOLLOW_UP_STATUSES] },
            dueDate: { [Op.between]: [from, until] },
          },
          include: [
            { model: Customer, attributes: ['id', 'name'] },
            { model: Project, attributes: ['id', 'name'] },
          ],
        });
        return rows.map((f) => {
          const kind = kindOf(f.dueDate, today);
          return {
            key: dueKey(eventType, 'FOLLOW_UP', f.id, kind, f.dueDate),
            refType: 'FOLLOW_UP',
            refId: f.id,
            kind,
            sortDate: f.dueDate,
            item: digestItem(`ติดตาม: ${f.title}`, [
              `ลูกค้า: ${f.customer?.name ?? '-'}`,
              f.project ? `โปรเจกต์: ${f.project.name}` : null,
              dateLine('ครบกำหนด', f.dueDate, today),
            ]),
          };
        });
      }

      case NotificationEventType.TICKET_SLA: {
        const rows = await this.ticketModel.findAll({
          where: {
            status: { [Op.in]: OPEN_TICKET_STATUSES },
            dueAt: { [Op.gte]: new Date(`${from}T00:00:00`), [Op.lt]: now },
          },
          include: [
            { model: Customer, attributes: ['id', 'name'] },
            { model: Project, attributes: ['id', 'name'] },
          ],
        });
        return rows.map((t) => {
          const dueAt = t.dueAt as Date;
          const due = toDateOnly(dueAt);
          return {
            key: dueKey(eventType, 'TICKET', t.id, 'OVERDUE', dueAt.toISOString()),
            refType: 'TICKET',
            refId: t.id,
            kind: 'OVERDUE' as const,
            sortDate: dueAt.toISOString(),
            item: digestItem(`ปัญหา: ${t.title}`, [
              `ลูกค้า: ${t.customer?.name ?? '-'}`,
              t.project ? `โปรเจกต์: ${t.project.name}` : null,
              dateLine('กำหนดส่ง', due, today, true),
            ]),
          };
        });
      }

      case NotificationEventType.WARRANTY_EXPIRING: {
        const rows = await this.warrantyModel.findAll({
          where: {
            status: { [Op.ne]: WarrantyStatus.VOID },
            endDate: { [Op.between]: [today, until] },
          },
          include: [
            {
              model: Project,
              attributes: ['id', 'name'],
              include: [{ model: Customer, attributes: ['id', 'name'] }],
            },
          ],
        });
        return rows.map((w) => ({
          key: dueKey(eventType, 'WARRANTY', w.id, 'UPCOMING', w.endDate),
          refType: 'WARRANTY',
          refId: w.id,
          kind: 'UPCOMING' as const,
          sortDate: w.endDate,
          item: digestItem(`โปรเจกต์: ${w.project?.name ?? '-'}`, [
            `ลูกค้า: ${w.project?.customer?.name ?? '-'}`,
            dateLine('ประกันหมด', w.endDate, today),
          ]),
        }));
      }

      case NotificationEventType.MA_EXPIRING: {
        const rows = await this.maContractModel.findAll({
          where: {
            status: MaContractStatus.ACTIVE,
            startDate: { [Op.lte]: today },
            endDate: { [Op.between]: [today, until] },
          },
          include: [
            { model: Customer, attributes: ['id', 'name'] },
            { model: Project, attributes: ['id', 'name'] },
          ],
        });
        return rows.map((c) => ({
          key: dueKey(eventType, 'MA_CONTRACT', c.id, 'UPCOMING', c.endDate),
          refType: 'MA_CONTRACT',
          refId: c.id,
          kind: 'UPCOMING' as const,
          sortDate: c.endDate,
          item: digestItem(`โปรเจกต์: ${c.project?.name ?? '-'}`, [
            `ลูกค้า: ${c.customer?.name ?? '-'}`,
            dateLine('สัญญาหมด', c.endDate, today),
          ]),
        }));
      }

      default:
        return [];
    }
  }
}

function daysFor(rule: NotificationRule): number {
  return rule.daysBefore ?? DIGEST_DEFAULT_DAYS[rule.eventType] ?? 0;
}
