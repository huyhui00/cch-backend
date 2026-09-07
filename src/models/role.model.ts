import { BelongsToMany, Column, DataType, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Permission } from './permission.model';
import { RolePermission } from './role-permission.model';
import { User } from './user.model';
import { UserRole } from './user-role.model';

/**
 * Role เป็น dynamic ทั้งหมด ไม่ hardcode ในโค้ด
 * Super Admin เท่านั้นที่สร้าง/แก้/ลบได้ (BR-10)
 */
/** ฟิลด์ที่ส่งได้ตอน create — ดูหมายเหตุใน UserCreationAttributes */
export interface RoleCreationAttributes {
  name: string;
  description?: string | null;
  isSystem?: boolean;
  isActive?: boolean;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'roles', underscored: true, timestamps: true, paranoid: true })
export class Role extends AuditedModel<Role, RoleCreationAttributes> {
  @Column({ type: DataType.STRING(100), allowNull: false })
  name: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  description: string | null;

  /** role ที่ระบบสร้างให้ตอน seed ห้ามลบ */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_system' })
  isSystem: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
  isActive: boolean;

  @BelongsToMany(() => Permission, () => RolePermission)
  permissions: Permission[];

  @BelongsToMany(() => User, () => UserRole)
  users: User[];

  @HasMany(() => RolePermission)
  rolePermissions: RolePermission[];
}
