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

import { Permission } from './permission.model';
import { Role } from './role.model';

/**
 * Junction table — composite primary key (role_id, permission_id)
 * ไม่เปิด paranoid ด้วยเหตุผลเดียวกับ user_roles
 */
/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface RolePermissionCreationAttributes {
  roleId: number;
  permissionId: number;
  createdBy?: number | null;
}

@Table({
  tableName: 'role_permissions',
  underscored: true,
  timestamps: true,
  paranoid: false,
  updatedAt: false,
})
export class RolePermission extends Model<RolePermission, RolePermissionCreationAttributes> {
  @PrimaryKey
  @ForeignKey(() => Role)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'role_id' })
  roleId: number;

  @PrimaryKey
  @ForeignKey(() => Permission)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'permission_id' })
  permissionId: number;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  createdAt: Date;

  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: true, field: 'created_by' })
  createdBy: number | null;

  @BelongsTo(() => Role)
  role: Role;

  @BelongsTo(() => Permission)
  permission: Permission;
}
