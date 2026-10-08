import { BelongsTo, Column, DataType, ForeignKey, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Project } from './project.model';
import { User } from './user.model';
import { TaskSubmission } from './task-submission.model';

export enum TaskStatus {
  TODO = 'TODO',
  DOING = 'DOING',
  WAITING = 'WAITING',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export interface TaskCreationAttributes {
  projectId: number;
  parentTaskId?: number | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedUserId?: number | null;
  assignedByUserId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  completedAt?: Date | null;
  estimatedHours?: string | null;
  actualHours?: string | null;
  sortOrder?: number;
  createdBy?: number | null;
  updatedBy?: number | null;
}

/**
 * Self-reference ผ่าน parent_task_id — task ซ้อน task ได้ไม่จำกัดชั้นในระดับฐานข้อมูล
 *
 * Q5 ได้ข้อสรุปแล้ว (8 ก.ย.) — "ลำดับก่อนหลัง" ที่ผู้บริหารพูดถึงคือการเรียงลำดับเฉย ๆ
 * ใช้ sort_order ส่วนงานที่ต้องทำก่อนให้ผู้ใช้ตั้ง priority เอง
 * **ไม่มีตาราง task_dependencies และห้ามเพิ่มคอลัมน์ depends_on ใด ๆ**
 * ระบบไม่บังคับว่างานไหนต้องเสร็จก่อนงานไหน
 */
@Table({ tableName: 'tasks', underscored: true, timestamps: true, paranoid: true })
export class Task extends AuditedModel<Task, TaskCreationAttributes> {
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

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'assigned_by_user_id' })
  assignedByUserId: number | null;

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

  @BelongsTo(() => User, 'assignedByUserId')
  assignedByUser: User;

  @HasMany(() => TaskSubmission, 'taskId')
  submissions: TaskSubmission[];
}
