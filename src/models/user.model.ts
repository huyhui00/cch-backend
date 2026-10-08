import { BelongsToMany, Column, DataType, HasMany, Table } from 'sequelize-typescript';

import { AuditedModel } from './base.model';
import { Role } from './role.model';
import { UserRole } from './user-role.model';

/** ระดับบัญชี — ผูกกับสิทธิ์จัดการ Role โดยตรง (BR-10) */
export enum AccountType {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  RESIGNED = 'RESIGNED',
}

export interface UserCreationAttributes {
  employeeCode?: string | null;
  username: string;
  email?: string | null;
  passwordHash: string;
  fullName: string;
  nickname?: string | null;
  phone?: string | null;
  position?: string | null;
  avatarUrl?: string | null;
  lineUserId?: string | null;
  accountType?: AccountType;
  status?: UserStatus;
  lastLoginAt?: Date | null;
  refreshTokenHash?: string | null;
  createdBy?: number | null;
  updatedBy?: number | null;
}

@Table({ tableName: 'users', underscored: true, timestamps: true, paranoid: true })
export class User extends AuditedModel<User, UserCreationAttributes> {
  @Column({ type: DataType.STRING(50), allowNull: true, field: 'employee_code' })
  employeeCode: string | null;

  @Column({ type: DataType.STRING(100), allowNull: false })
  username: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  email: string | null;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'password_hash' })
  passwordHash: string;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'full_name' })
  fullName: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  nickname: string | null;

  @Column({ type: DataType.STRING(30), allowNull: true })
  phone: string | null;

  @Column({ type: DataType.STRING(150), allowNull: true })
  position: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true, field: 'avatar_url' })
  avatarUrl: string | null;

  /** ใช้ส่งแจ้งเตือนเข้า LINE ของพนักงาน (BR-11 ภายในเท่านั้น) */
  @Column({ type: DataType.STRING(100), allowNull: true, field: 'line_user_id' })
  lineUserId: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(AccountType)),
    allowNull: false,
    defaultValue: AccountType.USER,
    field: 'account_type',
  })
  accountType: AccountType;

  @Column({
    type: DataType.ENUM(...Object.values(UserStatus)),
    allowNull: false,
    defaultValue: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_login_at' })
  lastLoginAt: Date | null;

  @Column({ type: DataType.STRING(255), allowNull: true, field: 'refresh_token_hash' })
  refreshTokenHash: string | null;

  @BelongsToMany(() => Role, () => UserRole)
  roles: Role[];

  @HasMany(() => UserRole)
  userRoles: UserRole[];
}
