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
  UpdatedAt,
} from 'sequelize-typescript';

import { User } from './user.model';

/** หนึ่งแถวต่อหนึ่งเครื่องที่ล็อกอินอยู่ (CLAUDE.md 4.4) — ลบจริง ไม่เปิด paranoid */
export interface UserSessionCreationAttributes {
  userId: number;
  refreshTokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastUsedAt: Date;
  expiresAt: Date;
}

@Table({ tableName: 'user_sessions', underscored: true, timestamps: true, paranoid: false })
export class UserSession extends Model<UserSession, UserSessionCreationAttributes> {
  @PrimaryKey
  @AutoIncrement
  @Column({ type: DataType.BIGINT.UNSIGNED })
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.BIGINT.UNSIGNED, allowNull: false, field: 'user_id' })
  userId: number;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'refresh_token_hash' })
  refreshTokenHash: string;

  @Column({ type: DataType.STRING(500), allowNull: true, field: 'user_agent' })
  userAgent: string | null;

  @Column({ type: DataType.STRING(45), allowNull: true, field: 'ip_address' })
  ipAddress: string | null;

  @Column({ type: DataType.DATE, allowNull: false, field: 'last_used_at' })
  lastUsedAt: Date;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expires_at' })
  expiresAt: Date;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  updatedAt: Date;

  @BelongsTo(() => User)
  user: User;
}
