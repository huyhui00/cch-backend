import { BelongsToMany, Column, DataType, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Role } from './role.model';
import { RolePermission } from './role-permission.model';

@Table({ tableName: 'permissions', underscored: true, timestamps: true, paranoid: true })
export class Permission extends AuditedModel<Permission> {
  @Column({ type: DataType.STRING(100), allowNull: false })
  code: string;

  @Column({ type: DataType.STRING(50), allowNull: false })
  module: string;

  @Column({ type: DataType.STRING(50), allowNull: false })
  action: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  description: string | null;

  @BelongsToMany(() => Role, () => RolePermission)
  roles: Role[];
}
