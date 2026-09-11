import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';
import { Project } from './project.model';
import { User } from './user.model';

export enum FollowUpStatus {
  PLANNED = 'PLANNED',
  DONE = 'DONE',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

/** งานติดตามลูกค้า — ป้อนเข้า notification rule แบบ FOLLOWUP_DUE */
export interface FollowUpCreationAttributes {
  customerId: number;
  projectId?: number | null;
  title: string;
  detail?: string | null;
  dueDate: string;
  status?: FollowUpStatus;
  assignedUserId?: number | null;
  completedAt?: Date | null;
  resultNote?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'follow_ups', underscored: true, timestamps: true, paranoid: true })
export class FollowUp extends AuditedModel<FollowUp, FollowUpCreationAttributes> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  /**
   * โปรเจคที่ติดตามอยู่ (ประชุม 11 ก.ย. — B-14) ยังเป็น null ได้ (Q16)
   * ระบุมาเมื่อไร `customerId` ต้องเป็นเจ้าของโปรเจคนี้เสมอ — service คัดลอกให้เอง
   */
  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'project_id' })
  projectId: number | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  detail: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'due_date' })
  dueDate: string;

  @Column({
    type: DataType.ENUM(...Object.values(FollowUpStatus)),
    allowNull: false,
    defaultValue: FollowUpStatus.PLANNED,
  })
  status: FollowUpStatus;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'assigned_user_id' })
  assignedUserId: number | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  completedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'result_note' })
  resultNote: string | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => Project)
  project: Project | null;

  @BelongsTo(() => User)
  assignedUser: User;
}
