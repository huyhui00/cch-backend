import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { NotificationEventType, NotificationRule } from './notification-rule.model';
import { User } from './user.model';

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  READ = 'READ',
}

/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface NotificationCreationAttributes {
  ruleId?: number | null;
  targetUserId: number;
  eventType: NotificationEventType;
  title: string;
  message?: string | null;
  refType?: string | null;
  refId?: number | null;
  status?: NotificationStatus;
  scheduledAt?: Date | null;
  sentAt?: Date | null;
  readAt?: Date | null;
  errorMessage?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

/**
 * BR-11 — แจ้งเตือนภายในบริษัทเท่านั้น ไม่ยิงหาลูกค้า
 * target_user_id จึงเป็น NOT NULL และชี้ไปที่ users เท่านั้น
 * ไม่มีคอลัมน์ customer_id หรือ contact_id ในตารางนี้โดยเจตนา
 */
@Table({ tableName: 'notifications', underscored: true, timestamps: true, paranoid: true })
export class Notification extends AuditedModel<Notification, NotificationCreationAttributes> {
  @ForeignKey(() => NotificationRule)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'rule_id' })
  ruleId: number | null;

  /** ปลายทางต้องเป็นพนักงานเสมอ (BR-11) */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'target_user_id' })
  targetUserId: number;

  @Column({
    type: DataType.ENUM(...Object.values(NotificationEventType)),
    allowNull: false,
    field: 'event_type',
  })
  eventType: NotificationEventType;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  message: string | null;

  /** ลิงก์กลับไปหาต้นเรื่อง เช่น ('TICKET', 42) */
  @Column({ type: DataType.STRING(50), allowNull: true, field: 'ref_type' })
  refType: string | null;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'ref_id' })
  refId: number | null;

  @Column({
    type: DataType.ENUM(...Object.values(NotificationStatus)),
    allowNull: false,
    defaultValue: NotificationStatus.PENDING,
  })
  status: NotificationStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'scheduled_at' })
  scheduledAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'sent_at' })
  sentAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'read_at' })
  readAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'error_message' })
  errorMessage: string | null;

  @BelongsTo(() => NotificationRule)
  rule: NotificationRule;

  @BelongsTo(() => User)
  targetUser: User;
}
