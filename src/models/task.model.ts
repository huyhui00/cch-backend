import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Project } from './project.model';
import { User } from './user.model';

export enum TaskStatus {
  TODO = 'TODO',
  DOING = 'DOING',
  WAITING = 'WAITING',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

/**
 * ระดับความสำคัญของงานย่อย (ประชุมครั้งที่ 2 นาที 07:31)
 * ใช้ชุดค่าเดียวกับ ProjectPriority เพื่อให้หน้าจอกรองข้ามระดับได้
 */
export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/**
 * Self-reference ผ่าน parent_task_id — task ซ้อน task ได้
 *
 * หมายเหตุ: CLAUDE.md ข้อ 10 (Q5) ยังไม่สรุปว่าซ้อนได้กี่ระดับ
 * ระดับฐานข้อมูลจึงไม่จำกัดความลึกไว้ ถ้าผู้บริหารสรุปเพดานเมื่อไหร่
 * ให้บังคับที่ service layer ไม่ต้องแก้ schema
 */
@Table({ tableName: 'tasks', underscored: true, timestamps: true, paranoid: true })
export class Task extends AuditedModel<Task> {
  @ForeignKey(() => Project)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'project_id' })
  projectId: number;

  @ForeignKey(() => Task)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'parent_task_id' })
  parentTaskId: number | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(TaskStatus)),
    allowNull: false,
    defaultValue: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Column({
    type: DataType.ENUM(...Object.values(TaskPriority)),
    allowNull: false,
    defaultValue: TaskPriority.NORMAL,
  })
  priority: TaskPriority;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'assigned_user_id' })
  assignedUserId: number | null;

  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'start_date' })
  startDate: string | null;

  /** ใช้กับ notification rule แบบ TASK_OVERDUE */
  @Column({ type: DataType.DATEONLY, allowNull: true, field: 'due_date' })
  dueDate: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  completedAt: Date | null;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'estimated_hours' })
  estimatedHours: string | null;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'actual_hours' })
  actualHours: string | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' })
  sortOrder: number;

  @BelongsTo(() => Project)
  project: Project;

  @BelongsTo(() => Task)
  parentTask: Task;

  // ต้องส่งชื่อ property (camelCase) ไม่ใช่ชื่อคอลัมน์ ไม่งั้น sequelize
  // จะสร้าง attribute ซ้ำชื่อ parent_task_id ขึ้นมาอีกตัว
  @HasMany(() => Task, 'parentTaskId')
  subTasks: Task[];

  @BelongsTo(() => User)
  assignedUser: User;
}
