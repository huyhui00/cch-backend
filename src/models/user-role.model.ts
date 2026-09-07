import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { Role } from './role.model';
import { User } from './user.model';

/**
 * Junction table — composite primary key (user_id, role_id)
 * ไม่เปิด paranoid เพราะการถอด role คือการถอดจริง
 * ร่องรอยการเปลี่ยนแปลงถูกเก็บใน audit_logs อยู่แล้ว (BR-09)
 */
/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface UserRoleCreationAttributes {
  userId: number;
  roleId: number;
  createdBy?: number | null;
}

@Table({
  tableName: 'user_roles',
  underscored: true,
  timestamps: true,
  paranoid: false,
  updatedAt: false,
})
export class UserRole extends Model<UserRole, UserRoleCreationAttributes> {
  @PrimaryKey
  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'user_id' })
  userId: number;

  @PrimaryKey
  @ForeignKey(() => Role)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'role_id' })
  roleId: number;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  createdAt: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'created_by' })
  createdBy: number | null;

  @BelongsTo(() => User)
  user: User;

  @BelongsTo(() => Role)
  role: Role;
}
