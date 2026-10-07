import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Role } from './role.model';
import { User } from './user.model';

export enum NotificationEventType {
  MA_EXPIRING = 'MA_EXPIRING',
  WARRANTY_EXPIRING = 'WARRANTY_EXPIRING',
  TASK_OVERDUE = 'TASK_OVERDUE',
  DELIVERY_DUE = 'DELIVERY_DUE',
  FOLLOWUP_DUE = 'FOLLOWUP_DUE',
  TICKET_SLA = 'TICKET_SLA',
  CUSTOMER_IDLE = 'CUSTOMER_IDLE',
  /** C-3 — ซัพพอร์ตส่งเข้าคิวแอดมิน (แจ้งในแอปอย่างเดียว) */
  TICKET_SENT_TO_ADMIN = 'TICKET_SENT_TO_ADMIN',
  /** C-3 — พนักงานบันทึกผลแก้แล้ว รอแอดมินตรวจผ่าน */
  TICKET_AWAITING_REVIEW = 'TICKET_AWAITING_REVIEW',
  /** C-3 — แอดมินตรวจผ่านแล้ว ส่งกลับซัพพอร์ตบอกลูกค้า */
  TICKET_RETURNED_TO_SUPPORT = 'TICKET_RETURNED_TO_SUPPORT',
  /** C-3 — แอดมินมอบหมายใบให้พนักงานแก้ */
  TICKET_ASSIGNED = 'TICKET_ASSIGNED',
  /** C-1 — แอดมินตรวจไม่ผ่าน ตีกลับให้ผู้แก้ทำต่อ */
  TICKET_REVIEW_REJECTED = 'TICKET_REVIEW_REJECTED',
  /** สรุปประจำวันรูปแบบเดิม (ใช้ 7 ต.ค. วันเดียว) — เหลือไว้ให้แถวเก่าอ่านได้ ไม่ถูกสร้างใหม่ สร้างเป็นกฎไม่ได้ */
  DAILY_DIGEST = 'DAILY_DIGEST',
}

/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface NotificationRuleCreationAttributes {
  name: string;
  eventType: NotificationEventType;
  daysBefore?: number | null;
  isActive?: boolean;
  targetRoleId?: number | null;
  targetUserId?: number | null;
  messageTemplate?: string | null;
  sendLine?: boolean;
  cronExpression?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

/**
 * กติกาการแจ้งเตือนที่ scheduler เอาไปรัน
 *
 * BR-11 — แจ้งเตือนภายในบริษัทเท่านั้น ปลายทางจึงเป็น role หรือ user
 * ไม่มีทางเลือกที่ยิงหาลูกค้าได้เลยแม้แต่ช่องเดียว
 */
@Table({ tableName: 'notification_rules', underscored: true, timestamps: true, paranoid: true })
export class NotificationRule extends AuditedModel<
  NotificationRule,
  NotificationRuleCreationAttributes
> {
  @Column({ type: DataType.STRING(150), allowNull: false })
  name: string;

  @Column({
    type: DataType.ENUM(...Object.values(NotificationEventType)),
    allowNull: false,
    field: 'event_type',
  })
  eventType: NotificationEventType;

  /** แจ้งล่วงหน้ากี่วัน เช่น MA_EXPIRING 30 วัน */
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'days_before' })
  daysBefore: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
  isActive: boolean;

  /** ส่งให้ทุกคนใน role นี้ */
  @ForeignKey(() => Role)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'target_role_id' })
  targetRoleId: number | null;

  /** หรือเจาะจงคนเดียว */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'target_user_id' })
  targetUserId: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'message_template' })
  messageTemplate: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'send_line' })
  sendLine: boolean;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'cron_expression' })
  cronExpression: string | null;

  @BelongsTo(() => Role)
  targetRole: Role;

  @BelongsTo(() => User)
  targetUser: User;
}
