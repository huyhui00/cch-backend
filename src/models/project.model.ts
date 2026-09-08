import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Customer } from './customer.model';
import { Task } from './task.model';
import { User } from './user.model';

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ProjectPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface ProjectCreationAttributes {
  customerId: number;
  code?: string | null;
  name: string;
  description?: string | null;
  projectType?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: string | null;
  targetEndDate?: string | null;
  actualEndDate?: string | null;
  contractValue?: string | null;
  functionCount?: number | null;
  managerUserId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'projects', underscored: true, timestamps: true, paranoid: true })
export class Project extends AuditedModel<Project, ProjectCreationAttributes> {
  @ForeignKey(() => Customer)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'customer_id' })
  customerId: number;

  @Column({ type: DataType.STRING(50), allowNull: true })
  code: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  /** SOFTWARE / HARDWARE / IOT ฯลฯ — ยังไม่ได้กำหนดเป็น enum ใน CLAUDE.md ข้อ 8 */
  @Column({ type: DataType.STRING(100), allowNull: true, field: 'project_type' })
  projectType: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ProjectStatus)),
    allowNull: false,
    defaultValue: ProjectStatus.DRAFT,
  })
  status: ProjectStatus;

  @Column({
    type: DataType.ENUM(...Object.values(ProjectPriority)),
    allowNull: false,
    defaultValue: ProjectPriority.NORMAL,
  })
  priority: ProjectPriority;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'start_date' })
  startDate: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'target_end_date' })
  targetEndDate: string | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'actual_end_date' })
  actualEndDate: string | null;

  @Column({ type: DataType.DECIMAL(15, 2), allowNull: true, field: 'contract_value' })
  contractValue: string | null;

  /**
   * จำนวนฟังก์ชันของโครงการ — ใช้เป็นตัวตั้งคิดราคา MA ภายหลัง (Phase 8)
   * โครงการที่มีฟังก์ชันเยอะมีพื้นที่ให้เกิดบั๊กเยอะกว่า ค่าดูแลรายปีจึงต่างกัน
   * ทั้งที่เนื้อหาแผน MA เหมือนกันทุกโครงการ (BR-05)
   */
  @Column({ type: DataType.INTEGER.UNSIGNED, allowNull: true, field: 'function_count' })
  functionCount: number | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'manager_user_id' })
  managerUserId: number | null;

  @BelongsTo(() => Customer)
  customer: Customer;

  @BelongsTo(() => User)
  manager: User;

  @HasMany(() => Task)
  tasks: Task[];
}
