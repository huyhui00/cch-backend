import { BelongsTo, Column, DataType, ForeignKey, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Task } from './task.model';
import { User } from './user.model';

export enum TaskSubmissionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface TaskSubmissionCreationAttributes {
  taskId: number;
  submittedByUserId: number;
  report: string;
  actualHours?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  status?: TaskSubmissionStatus;
  reviewedByUserId?: number | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  reviewFileUrl?: string | null;
  reviewFileName?: string | null;
  reviewFileSize?: number | null;
  reviewMimeType?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'task_submissions', underscored: true, timestamps: true, paranoid: true })
export class TaskSubmission extends AuditedModel<TaskSubmission, TaskSubmissionCreationAttributes> {
  @ForeignKey(() => Task)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'task_id' })
  taskId: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'submitted_by_user_id' })
  submittedByUserId: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  report: string;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'actual_hours' })
  actualHours: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true, field: 'file_url' })
  fileUrl: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'file_name' })
  fileName: string | null;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'file_size' })
  fileSize: number | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'mime_type' })
  mimeType: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(TaskSubmissionStatus)),
    allowNull: false,
    defaultValue: TaskSubmissionStatus.PENDING,
  })
  status: TaskSubmissionStatus;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'reviewed_by_user_id' })
  reviewedByUserId: number | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'reviewed_at' })
  reviewedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'review_note' })
  reviewNote: string | null;

  /** ไฟล์ที่ผู้ตรวจแนบตอนส่งกลับแก้ — แยกจากไฟล์รายงานของผู้ส่ง */
  @Column({ type: DataType.STRING(500), allowNull: true, field: 'review_file_url' })
  reviewFileUrl: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'review_file_name' })
  reviewFileName: string | null;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'review_file_size' })
  reviewFileSize: number | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'review_mime_type' })
  reviewMimeType: string | null;

  @BelongsTo(() => Task)
  task: Task;

  @BelongsTo(() => User, 'submittedByUserId')
  submittedBy: User;

  @BelongsTo(() => User, 'reviewedByUserId')
  reviewedBy: User;
}
