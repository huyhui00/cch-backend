import {
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { User } from './user.model';

/**
 * ทุก action ต้องบันทึกผู้กระทำ (BR-09)
 * เขียนครั้งเดียวที่ global hook เท่านั้น ห้ามเขียนซ้ำในแต่ละ service (CLAUDE.md 6.4)
 *
 * ตารางนี้เป็น append-only — ไม่มี updated_at / deleted_at และไม่เปิด paranoid
 * เพราะ audit log ที่แก้ไขหรือลบได้ก็ไม่ใช่ audit log
 */
/**
 * ชนิดของ action ที่ถูกบันทึก
 *
 * ตัวที่ขึ้นต้นด้วย BULK_ มาจากคำสั่งที่กระทำหลายแถวพร้อมกัน (bulkCreate / update / destroy
 * แบบระบุ where) ซึ่ง Sequelize ไม่ส่งข้อมูลรายแถวมาให้ จึงบันทึกได้แค่ระดับคำสั่ง
 */
export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  BULK_CREATE = 'BULK_CREATE',
  BULK_UPDATE = 'BULK_UPDATE',
  BULK_DELETE = 'BULK_DELETE',
}

/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface AuditLogCreationAttributes {
  userId?: number | null;
  action: string;
  tableName: string;
  recordId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Table({
  tableName: 'audit_logs',
  underscored: true,
  timestamps: true,
  paranoid: false,
  updatedAt: false,
})
export class AuditLog extends Model<AuditLog, AuditLogCreationAttributes> {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.BIGINT.UNSIGNED })
  id: number;

  /** null ได้ในกรณีที่ระบบเป็นผู้กระทำเอง เช่น scheduler */
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'user_id' })
  userId: number | null;

  @Column({ type: DataType.STRING(50), allowNull: false })
  action: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'table_name' })
  tableName: string;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'record_id' })
  recordId: number | null;

  @Column({ type: DataType.JSON, allowNull: true, field: 'old_value' })
  oldValue: unknown;

  @Column({ type: DataType.JSON, allowNull: true, field: 'new_value' })
  newValue: unknown;

  @Column({ type: DataType.STRING(45), allowNull: true, field: 'ip_address' })
  ipAddress: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true, field: 'user_agent' })
  userAgent: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  createdAt: Date;

  @BelongsTo(() => User)
  user: User;
}
